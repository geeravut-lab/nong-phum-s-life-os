import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Saved trip plans.
 *
 * Stops are stored as they were picked rather than as references, so a plan
 * still reads the way it did when it was saved even if a shop is later renamed
 * or removed. A plan is a record of an intention, not a live view of the
 * directory.
 */
const StopSchema = z.object({
  id: z.string().max(80),
  title: z.string().max(200),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  startsAt: z.string().max(40).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  venue: z.string().max(200).nullable().optional(),
  placeId: z.string().max(120).nullable().optional(),
});

export const listTripPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("trip_plans")
      .select("id, name, stops, updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { plans: data ?? [] };
  });

export const saveTripPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(80),
        stops: z.array(StopSchema).min(1).max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await supabaseAdmin
        .from("trip_plans")
        .update({ name: data.name.trim(), stops: data.stops, updated_at: new Date().toISOString() })
        .eq("id", data.id)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    // Twenty is not a technical limit; it is the point where a list of saved
    // plans stops being something a person can scan.
    const { count } = await supabaseAdmin
      .from("trip_plans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);
    if ((count ?? 0) >= 20) throw new Error("app:trip_plan_limit");

    const { data: row, error } = await supabaseAdmin
      .from("trip_plans")
      .insert({ user_id: context.userId, name: data.name.trim(), stops: data.stops })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const deleteTripPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("trip_plans")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
