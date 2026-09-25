import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireFamilyMember(userId: string, familyId: string) {
  const { data } = await supabaseAdmin
    .from("family_members")
    .select("id, member_role")
    .eq("family_id", familyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Not a family member");
  return data;
}

async function requireFamilyOwner(userId: string, familyId: string) {
  const { data } = await supabaseAdmin
    .from("families")
    .select("id, owner_id")
    .eq("id", familyId)
    .single();
  if (!data || data.owner_id !== userId) throw new Error("Only family owner");
  return data;
}

export const listFamilyEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ familyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireFamilyMember(context.userId, data.familyId);
    const { data: rows, error } = await supabaseAdmin
      .from("family_events")
      .select("id, title, starts_at, ends_at, all_day, notes, created_by")
      .eq("family_id", data.familyId)
      .gte("starts_at", new Date(Date.now() - 7 * 864e5).toISOString())
      .order("starts_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    return { events: rows ?? [] };
  });

export const createFamilyEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        familyId: z.string().uuid(),
        title: z.string().min(1).max(200),
        startsAt: z.string().min(1),
        endsAt: z.string().optional(),
        allDay: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireFamilyMember(context.userId, data.familyId);
    const { data: row, error } = await supabaseAdmin
      .from("family_events")
      .insert({
        family_id: data.familyId,
        created_by: context.userId,
        title: data.title,
        starts_at: data.startsAt,
        ends_at: data.endsAt ?? null,
        all_day: data.allDay ?? false,
        notes: data.notes ?? "",
      })
      .select("id, title, starts_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteFamilyEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ eventId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: ev } = await supabaseAdmin
      .from("family_events")
      .select("id, family_id, created_by")
      .eq("id", data.eventId)
      .single();
    if (!ev) throw new Error("not found");
    await requireFamilyMember(context.userId, ev.family_id as string);
    const { data: fam } = await supabaseAdmin
      .from("families")
      .select("owner_id")
      .eq("id", ev.family_id)
      .single();
    if (ev.created_by !== context.userId && fam?.owner_id !== context.userId) {
      throw new Error("Forbidden");
    }
    await supabaseAdmin.from("family_events").delete().eq("id", data.eventId);
    return { ok: true as const };
  });

export const postFamilyCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        familyId: z.string().uuid(),
        status: z.enum(["ok", "need_help", "emergency"]),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireFamilyMember(context.userId, data.familyId);
    const { data: row, error } = await supabaseAdmin
      .from("family_checkins")
      .insert({
        family_id: data.familyId,
        user_id: context.userId,
        status: data.status,
        note: data.note ?? "",
      })
      .select("id, status, created_at")
      .single();
    if (error) throw new Error(error.message);

    // Notify other members on need_help / emergency
    if (data.status !== "ok") {
      const { data: members } = await supabaseAdmin
        .from("family_members")
        .select("user_id")
        .eq("family_id", data.familyId)
        .neq("user_id", context.userId);
      const title =
        data.status === "emergency" ? "ฉุกเฉิน — ต้องการความช่วยเหลือ" : "สมาชิกต้องการความช่วยเหลือ";
      for (const m of members ?? []) {
        await supabaseAdmin.from("app_notifications").insert({
          user_id: m.user_id,
          kind: "family_checkin",
          title,
          body: data.note || title,
          href: "/family",
          ref_table: "family_checkins",
          ref_id: row.id,
        });
      }
    }
    return row;
  });

export const listFamilyCheckins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ familyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireFamilyMember(context.userId, data.familyId);
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("family_checkins")
      .select("id, user_id, status, note, created_at")
      .eq("family_id", data.familyId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);
    return { checkins: rows ?? [] };
  });

export const assignFamilyTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        familyId: z.string().uuid(),
        title: z.string().min(1).max(200),
        dueAt: z.string().optional(),
        assigneeUserId: z.string().uuid().optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireFamilyMember(context.userId, data.familyId);
    if (data.assigneeUserId) {
      await requireFamilyMember(data.assigneeUserId, data.familyId);
    }
    const { data: row, error } = await supabaseAdmin
      .from("reminders")
      .insert({
        user_id: context.userId,
        family_id: data.familyId,
        is_shared: true,
        title: data.title,
        due_at: data.dueAt || null,
        priority: data.priority ?? "normal",
        assignee_user_id: data.assigneeUserId ?? null,
        status: "open",
      })
      .select("id, title, assignee_user_id")
      .single();
    if (error) throw new Error(error.message);

    if (data.assigneeUserId && data.assigneeUserId !== context.userId) {
      await supabaseAdmin.from("app_notifications").insert({
        user_id: data.assigneeUserId,
        kind: "family_task",
        title: "งานครอบครัวที่มอบหมายให้คุณ",
        body: data.title,
        href: "/tasks",
        ref_table: "reminders",
        ref_id: row.id,
      });
    }
    return row;
  });

export const listFamilyPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ familyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireFamilyMember(context.userId, data.familyId);
    const { data: rows, error } = await supabaseAdmin
      .from("family_permissions")
      .select(
        "id, user_id, can_view_docs, can_view_tasks, can_view_expenses, can_view_calendar, can_edit_shared",
      )
      .eq("family_id", data.familyId);
    if (error) throw new Error(error.message);
    return { permissions: rows ?? [] };
  });

export const upsertFamilyPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        familyId: z.string().uuid(),
        userId: z.string().uuid(),
        canViewDocs: z.boolean(),
        canViewTasks: z.boolean(),
        canViewExpenses: z.boolean(),
        canViewCalendar: z.boolean(),
        canEditShared: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireFamilyOwner(context.userId, data.familyId);
    await requireFamilyMember(data.userId, data.familyId);
    const { data: row, error } = await supabaseAdmin
      .from("family_permissions")
      .upsert(
        {
          family_id: data.familyId,
          user_id: data.userId,
          can_view_docs: data.canViewDocs,
          can_view_tasks: data.canViewTasks,
          can_view_expenses: data.canViewExpenses,
          can_view_calendar: data.canViewCalendar,
          can_edit_shared: data.canEditShared,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "family_id,user_id" },
      )
      .select(
        "id, user_id, can_view_docs, can_view_tasks, can_view_expenses, can_view_calendar, can_edit_shared",
      )
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
