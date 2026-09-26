import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Local events, plus the ordering used by the multi-stop itinerary.
 *
 * Events are the time-bound half of "ของดีใกล้บ้าน": a weekend market, a
 * Saturday workshop, a temple fair. Places answer "where", events answer
 * "what is on, and when".
 */

export type LocalEventRow = {
  id: string;
  placeId: string | null;
  title: string;
  description: string;
  category: string;
  area: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
  /** Name of the linked place, for routing and display. */
  placeName: string | null;
  startsAt: string;
  endsAt: string | null;
  priceMin: number | null;
  priceMax: number | null;
  kidFriendly: boolean;
  isMine: boolean;
};

function toRow(r: Record<string, unknown>, uid: string): LocalEventRow {
  // Fall back to the linked place for the things a route needs. Inheriting at
  // write time only helps events saved since; reading it here also fixes rows
  // created before that, and keeps working if the place is later moved.
  const place = (r["local_places"] ?? null) as {
    name?: string | null;
    address?: string | null;
    area?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null;
  const lat = (r["lat"] as number | null) ?? place?.lat ?? null;
  const lng = (r["lng"] as number | null) ?? place?.lng ?? null;
  const address = (r["address"] as string | null) || place?.address || place?.area || null;

  return {
    id: r["id"] as string,
    placeId: (r["place_id"] as string | null) ?? null,
    title: (r["title"] as string) ?? "",
    description: (r["description"] as string) ?? "",
    category: (r["category"] as string) ?? "event",
    area: (r["area"] as string | null) ?? null,
    address,
    lat,
    lng,
    placeName: place?.name ?? null,
    mapsUrl: (r["maps_url"] as string | null) ?? null,
    startsAt: r["starts_at"] as string,
    endsAt: (r["ends_at"] as string | null) ?? null,
    priceMin: (r["price_min"] as number | null) ?? null,
    priceMax: (r["price_max"] as number | null) ?? null,
    kidFriendly: !!r["kid_friendly"],
    isMine: r["owner_user_id"] === uid,
  };
}

/**
 * Events from now onwards, soonest first.
 *
 * Filters mirror the question the blueprint uses as its example - budget, kids,
 * and how far ahead to look - so "somewhere to take the kids this evening under
 * 500" is expressible.
 */
export const listUpcomingLocalEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        withinDays: z.number().int().min(1).max(90).optional(),
        budgetMax: z.number().min(0).optional(),
        kidFriendly: z.boolean().optional(),
        mineOnly: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    const now = new Date();
    const until = new Date(now.getTime() + (data.withinDays ?? 14) * 86400000);

    let qb = supabaseAdmin
      .from("local_events")
      .select("*, local_places(name, address, area, lat, lng)")
      .limit(60);

    if (data.mineOnly) {
      // The owner's own management list: everything they have, newest first,
      // including events that already happened. Hiding past events from their
      // own list would leave them unable to edit or delete what they created.
      qb = qb.eq("owner_user_id", uid).order("starts_at", { ascending: false });
    } else {
      // The public list: on now or coming up, soonest first. An event that
      // started earlier but has not finished yet still counts as on.
      qb = qb
        .eq("is_active", true)
        .or(
          `ends_at.gte.${now.toISOString()},and(ends_at.is.null,starts_at.gte.${now.toISOString()})`,
        )
        .lte("starts_at", until.toISOString())
        .order("starts_at", { ascending: true });
    }
    if (data.kidFriendly) qb = qb.eq("kid_friendly", true);

    const { data: rows, error } = await qb;
    if (error) throw new Error(error.message);

    let events = (rows ?? []).map((r) => toRow(r as Record<string, unknown>, uid));

    // Budget is filtered here rather than in SQL: "not stated" (null) must not
    // be treated as free, and an event qualifies when its cheapest entry is
    // within budget.
    if (data.budgetMax != null) {
      const cap = data.budgetMax;
      events = events.filter((e) => e.priceMin == null || Number(e.priceMin) <= cap);
    }

    return { events };
  });

export const upsertLocalEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        placeId: z.string().uuid().nullable().optional(),
        title: z.string().min(1).max(160),
        description: z.string().max(1000).optional(),
        category: z.string().max(40).optional(),
        area: z.string().max(120).optional(),
        address: z.string().max(300).optional(),
        mapsUrl: z.string().max(500).optional(),
        startsAt: z.string().min(1),
        endsAt: z.string().optional(),
        priceMin: z.number().min(0).nullable().optional(),
        priceMax: z.number().min(0).nullable().optional(),
        kidFriendly: z.boolean().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;

    // Attaching to a place is only allowed for a place the caller owns.
    // When attached, the event inherits the place's pin and address unless it
    // states its own: without coordinates an event routes by its title, and a
    // title like "แข่งกิน" is an event name that Google Maps cannot find.
    let inherited: { lat: number | null; lng: number | null; address: string | null } = {
      lat: null,
      lng: null,
      address: null,
    };
    if (data.placeId) {
      const { data: place } = await supabaseAdmin
        .from("local_places")
        .select("id, owner_user_id, lat, lng, address, area")
        .eq("id", data.placeId)
        .maybeSingle();
      if (!place || place.owner_user_id !== uid) throw new Error("Forbidden");
      inherited = {
        lat: (place.lat as number | null) ?? null,
        lng: (place.lng as number | null) ?? null,
        address: ((place.address as string | null) || (place.area as string | null)) ?? null,
      };
    }

    const fields = {
      place_id: data.placeId ?? null,
      title: data.title.trim(),
      description: data.description?.trim() ?? "",
      category: data.category?.trim() || "event",
      area: data.area?.trim() || null,
      address: data.address?.trim() || inherited.address,
      lat: inherited.lat,
      lng: inherited.lng,
      maps_url: data.mapsUrl?.trim() || null,
      starts_at: data.startsAt,
      ends_at: data.endsAt || null,
      price_min: data.priceMin ?? null,
      price_max: data.priceMax ?? null,
      kid_friendly: data.kidFriendly ?? false,
      ...(data.isActive !== undefined ? { is_active: data.isActive } : {}),
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("local_events")
        .update(fields)
        .eq("id", data.id)
        .eq("owner_user_id", uid);
      if (error) throw new Error(error.message);
      return { ok: true as const, id: data.id };
    }

    const { data: row, error } = await supabaseAdmin
      .from("local_events")
      .insert({ ...fields, owner_user_id: uid })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, id: row.id as string };
  });

export const deleteLocalEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("local_events")
      .delete()
      .eq("id", data.id)
      .eq("owner_user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
