import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Family Radar routine tracking.
 *
 * A routine is a habit the family chose to follow for one member ("morning
 * walk", "takes medicine"), with an expected cadence. Logging is a date, not a
 * measurement. Detection of a missed pattern is deterministic and lives in the
 * scheduled tick (cron.server.ts), never in the AI layer.
 */

async function requireMember(userId: string, familyId: string) {
  const { data } = await supabaseAdmin
    .from("family_members")
    .select("id")
    .eq("family_id", familyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Not a family member");
}

export type RoutineRow = {
  id: string;
  subjectUserId: string;
  title: string;
  note: string;
  intervalDays: number;
  graceDays: number;
  isActive: boolean;
  lastLoggedOn: string | null;
  /** Whole days since the last log, null when never logged. */
  daysSince: number | null;
  /** True once the gap exceeds intervalDays + graceDays. */
  overdue: boolean;
};

export const listFamilyRoutines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ familyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireMember(context.userId, data.familyId);

    const { data: rows, error } = await supabaseAdmin
      .from("family_routines")
      .select("id, subject_user_id, title, note, interval_days, grace_days, is_active")
      .eq("family_id", data.familyId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id as string);
    const latest = new Map<string, string>();
    if (ids.length > 0) {
      const { data: logs } = await supabaseAdmin
        .from("routine_logs")
        .select("routine_id, logged_on")
        .in("routine_id", ids)
        .order("logged_on", { ascending: false });
      // Rows come newest first, so the first one seen per routine is its latest.
      for (const l of logs ?? []) {
        const rid = l.routine_id as string;
        if (!latest.has(rid)) latest.set(rid, l.logged_on as string);
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const routines: RoutineRow[] = (rows ?? []).map((r) => {
      const last = latest.get(r.id as string) ?? null;
      let daysSince: number | null = null;
      if (last) {
        const d = new Date(last + "T00:00:00");
        daysSince = Math.floor((today.getTime() - d.getTime()) / 86400000);
      }
      const limit = (r.interval_days as number) + (r.grace_days as number);
      return {
        id: r.id as string,
        subjectUserId: r.subject_user_id as string,
        title: r.title as string,
        note: (r.note as string) ?? "",
        intervalDays: r.interval_days as number,
        graceDays: r.grace_days as number,
        isActive: !!r.is_active,
        lastLoggedOn: last,
        daysSince,
        overdue: !!r.is_active && daysSince != null && daysSince > limit,
      };
    });

    return { routines };
  });

export const upsertFamilyRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        familyId: z.string().uuid(),
        subjectUserId: z.string().uuid(),
        title: z.string().min(1).max(120),
        note: z.string().max(500).optional(),
        intervalDays: z.number().int().min(1).max(90),
        graceDays: z.number().int().min(0).max(30),
        isActive: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context.userId, data.familyId);
    // The subject has to be in the same family - otherwise a member could
    // start tracking someone outside it.
    await requireMember(data.subjectUserId, data.familyId);

    const fields = {
      family_id: data.familyId,
      subject_user_id: data.subjectUserId,
      title: data.title.trim(),
      note: data.note?.trim() ?? "",
      interval_days: data.intervalDays,
      grace_days: data.graceDays,
      ...(data.isActive !== undefined ? { is_active: data.isActive } : {}),
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("family_routines")
        .update(fields)
        .eq("id", data.id)
        .eq("family_id", data.familyId);
      if (error) throw new Error(error.message);
      return { ok: true as const, id: data.id };
    }

    const { data: row, error } = await supabaseAdmin
      .from("family_routines")
      .insert({ ...fields, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, id: row.id as string };
  });

export const deleteFamilyRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: r } = await supabaseAdmin
      .from("family_routines")
      .select("id, family_id, created_by")
      .eq("id", data.id)
      .maybeSingle();
    if (!r) throw new Error("not found");
    await requireMember(context.userId, r.family_id as string);

    const { data: fam } = await supabaseAdmin
      .from("families")
      .select("owner_id")
      .eq("id", r.family_id as string)
      .single();
    // Same rule as family events: whoever set it up, or the family owner.
    if (r.created_by !== context.userId && fam?.owner_id !== context.userId) {
      throw new Error("Forbidden");
    }
    const { error } = await supabaseAdmin.from("family_routines").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const logRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        routineId: z.string().uuid(),
        /** Defaults to today in Bangkok, set by the database. */
        loggedOn: z.string().optional(),
        note: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: r } = await supabaseAdmin
      .from("family_routines")
      .select("id, family_id")
      .eq("id", data.routineId)
      .maybeSingle();
    if (!r) throw new Error("not found");
    await requireMember(context.userId, r.family_id as string);

    const { error } = await supabaseAdmin.from("routine_logs").upsert(
      {
        routine_id: data.routineId,
        logged_by: context.userId,
        ...(data.loggedOn ? { logged_on: data.loggedOn } : {}),
        note: data.note?.trim() ?? "",
      },
      // One row per routine per day; logging twice just refreshes the note.
      { onConflict: "routine_id,logged_on" },
    );
    if (error) throw new Error(error.message);

    // A fresh log means the pattern is back to normal, so the next gap can
    // alert again.
    await supabaseAdmin
      .from("family_routines")
      .update({ alerted_at: null })
      .eq("id", data.routineId);

    return { ok: true as const };
  });
