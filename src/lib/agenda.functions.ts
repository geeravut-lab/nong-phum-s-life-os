import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AgendaSource = "task" | "family_event" | "money" | "helpme" | "warranty";

export type AgendaItem = {
  id: string;
  source: AgendaSource;
  title: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
  detail: string;
  editable: boolean;
  href: string;
  meta: {
    amount?: number | null;
    assigneeUserId?: string | null;
    familyId?: string | null;
    priority?: string | null;
  };
};

function isFutureOrToday(iso: string | null | undefined): boolean {
  if (!iso) return true;
  const d = new Date(iso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return d.getTime() >= startOfToday.getTime() - 864e5; // include yesterday buffer for open items
}

/** Unified agenda across tasks, family calendar, money due-ish, helpme jobs. */
export const listUnifiedAgenda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    const from = data.from ? new Date(data.from) : new Date(Date.now() - 14 * 864e5);
    const to = data.to ? new Date(data.to) : new Date(Date.now() + 60 * 864e5);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const items: AgendaItem[] = [];

    // 1) Reminders / tasks (own + shared family)
    const { data: membership } = await supabaseAdmin
      .from("family_members")
      .select("family_id")
      .eq("user_id", uid)
      .maybeSingle();
    const familyId = membership?.family_id as string | undefined;

    let reminderQuery = supabaseAdmin
      .from("reminders")
      .select(
        "id, title, due_at, status, priority, is_shared, family_id, assignee_user_id, notes, user_id",
      )
      .neq("status", "cancelled");

    const { data: reminders } = await reminderQuery
      .or(
        familyId
          ? `user_id.eq.${uid},and(is_shared.eq.true,family_id.eq.${familyId})`
          : `user_id.eq.${uid}`,
      )
      .limit(200);

    for (const r of reminders ?? []) {
      const starts = (r.due_at as string | null) || r.id; // undated still list
      if (r.due_at && (r.due_at < fromIso || r.due_at > toIso)) continue;
      const open = r.status === "open" || r.status === "pending";
      items.push({
        id: r.id as string,
        source: "task",
        title: r.title as string,
        startsAt: (r.due_at as string) || new Date().toISOString(),
        endsAt: null,
        status: r.status as string,
        detail: (r.notes as string) || "",
        editable: open && isFutureOrToday(r.due_at as string | null),
        href: "/tasks",
        meta: {
          assigneeUserId: (r.assignee_user_id as string | null) ?? null,
          familyId: (r.family_id as string | null) ?? null,
          priority: (r.priority as string) ?? null,
        },
      });
    }

    // 2) Family events
    if (familyId) {
      const { data: events } = await supabaseAdmin
        .from("family_events")
        .select("id, title, starts_at, ends_at, notes")
        .eq("family_id", familyId)
        .gte("starts_at", fromIso)
        .lte("starts_at", toIso)
        .order("starts_at", { ascending: true })
        .limit(100);
      for (const e of events ?? []) {
        items.push({
          id: e.id as string,
          source: "family_event",
          title: e.title as string,
          startsAt: e.starts_at as string,
          endsAt: (e.ends_at as string | null) ?? null,
          status: "scheduled",
          detail: (e.notes as string) || "",
          editable: isFutureOrToday(e.starts_at as string),
          href: "/family",
          meta: { familyId },
        });
      }
    }

    // 3) Money — expenses with future spent_on? usually past; include bills via document due in reminders already.
    // Also surface open high-value planned: skip heavy. Optional: documents due_date
    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("id, title, due_date, warranty_until, is_warranty, amount")
      .eq("user_id", uid)
      .eq("kind", "analyzed")
      .or("due_date.not.is.null,warranty_until.not.is.null")
      .limit(80);
    for (const d of docs ?? []) {
      const dates = [d.due_date, d.warranty_until].filter(Boolean) as string[];
      for (const dt of dates) {
        const iso = `${dt}T09:00:00+07:00`;
        if (iso < fromIso || iso > toIso) continue;
        items.push({
          id: `${d.id}-${dt}`,
          source: d.is_warranty || d.warranty_until === dt ? "warranty" : "money",
          title: d.title as string,
          startsAt: iso,
          endsAt: null,
          status: "due",
          detail: d.is_warranty ? "หมดประกัน/ครบกำหนด" : "ครบกำหนดเอกสาร",
          editable: false,
          href: "/docs",
          meta: { amount: d.amount != null ? Number(d.amount) : null },
        });
      }
    }

    // 4) Help Me jobs with scheduled_at (as requester or assigned helper)
    const { data: helperProf } = await supabaseAdmin
      .from("helper_profiles")
      .select("id")
      .eq("user_id", uid)
      .maybeSingle();

    let jobsQuery = supabaseAdmin
      .from("jobs")
      .select("id, title, scheduled_at, status, user_id, assigned_helper_id, location_text")
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", fromIso)
      .lte("scheduled_at", toIso)
      .limit(80);

    const { data: jobsOwn } = await supabaseAdmin
      .from("jobs")
      .select("id, title, scheduled_at, status, user_id, assigned_helper_id, location_text")
      .eq("user_id", uid)
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", fromIso)
      .lte("scheduled_at", toIso)
      .limit(80);

    let jobsAssigned: typeof jobsOwn = [];
    if (helperProf?.id) {
      const { data } = await supabaseAdmin
        .from("jobs")
        .select("id, title, scheduled_at, status, user_id, assigned_helper_id, location_text")
        .eq("assigned_helper_id", helperProf.id)
        .not("scheduled_at", "is", null)
        .gte("scheduled_at", fromIso)
        .lte("scheduled_at", toIso)
        .limit(80);
      jobsAssigned = data ?? [];
    }

    const jobMap = new Map<string, typeof jobsOwn extends (infer U)[] | null ? U : never>();
    for (const j of [...(jobsOwn ?? []), ...(jobsAssigned ?? [])]) {
      jobMap.set(j.id as string, j);
    }
    for (const j of jobMap.values()) {
      const st = j.status as string;
      const editable =
        ["open", "quoted", "booked", "assigned", "in_progress"].includes(st) &&
        isFutureOrToday(j.scheduled_at as string);
      items.push({
        id: j.id as string,
        source: "helpme",
        title: j.title as string,
        startsAt: j.scheduled_at as string,
        endsAt: null,
        status: st,
        detail: (j.location_text as string) || "",
        editable,
        href: "/helpme",
        meta: {},
      });
    }

    items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    return { items, familyId: familyId ?? null };
  });

/** Edit unified item when still editable. */
export const updateAgendaItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        source: z.enum(["task", "family_event", "helpme"]),
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        startsAt: z.string().optional(),
        notes: z.string().max(1000).optional(),
        status: z.string().max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;

    if (data.source === "task") {
      const { data: r, error } = await supabaseAdmin
        .from("reminders")
        .select("id, user_id, status, due_at, family_id, is_shared")
        .eq("id", data.id)
        .single();
      if (error || !r) throw new Error(error?.message ?? "not found");
      if (r.status !== "open" && r.status !== "pending") {
        throw new Error("รายการนี้แก้ไขไม่ได้แล้ว");
      }
      // allow owner or family member on shared
      if (r.user_id !== uid && r.is_shared && r.family_id) {
        await supabaseAdmin
          .from("family_members")
          .select("id")
          .eq("family_id", r.family_id)
          .eq("user_id", uid)
          .single()
          .then((x) => {
            if (x.error) throw new Error("Forbidden");
          });
      } else if (r.user_id !== uid) {
        throw new Error("Forbidden");
      }
      const { error: up } = await supabaseAdmin
        .from("reminders")
        .update({
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.startsAt !== undefined ? { due_at: data.startsAt } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        })
        .eq("id", data.id);
      if (up) throw new Error(up.message);
      return { ok: true as const };
    }

    if (data.source === "family_event") {
      const { data: e, error } = await supabaseAdmin
        .from("family_events")
        .select("id, family_id, starts_at, created_by")
        .eq("id", data.id)
        .single();
      if (error || !e) throw new Error(error?.message ?? "not found");
      if (!isFutureOrToday(e.starts_at as string)) {
        throw new Error("นัดที่ผ่านไปแล้วแก้ไขไม่ได้");
      }
      const { data: mem } = await supabaseAdmin
        .from("family_members")
        .select("id")
        .eq("family_id", e.family_id)
        .eq("user_id", uid)
        .maybeSingle();
      if (!mem) throw new Error("Forbidden");
      const { error: up } = await supabaseAdmin
        .from("family_events")
        .update({
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.startsAt !== undefined ? { starts_at: data.startsAt } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        })
        .eq("id", data.id);
      if (up) throw new Error(up.message);
      return { ok: true as const };
    }

    // helpme — only requester can reschedule open/booked jobs
    const { data: j, error } = await supabaseAdmin
      .from("jobs")
      .select("id, user_id, status, scheduled_at")
      .eq("id", data.id)
      .single();
    if (error || !j) throw new Error(error?.message ?? "not found");
    if (j.user_id !== uid) throw new Error("Forbidden");
    if (!["open", "quoted", "booked", "assigned"].includes(j.status as string)) {
      throw new Error("งานนี้แก้ไขเวลานัดไม่ได้แล้ว");
    }
    const { error: up } = await supabaseAdmin
      .from("jobs")
      .update({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.startsAt !== undefined ? { scheduled_at: data.startsAt } : {}),
      })
      .eq("id", data.id);
    if (up) throw new Error(up.message);
    return { ok: true as const };
  });

/** AI-assisted edit: natural language → structured update */
export const aiEditAgendaItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        source: z.enum(["task", "family_event", "helpme"]),
        id: z.string().uuid(),
        instruction: z.string().min(2).max(500),
        lang: z.enum(["th", "en"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Load current
    let currentTitle = "";
    let currentWhen = "";
    if (data.source === "task") {
      const { data: r } = await supabaseAdmin
        .from("reminders")
        .select("title, due_at")
        .eq("id", data.id)
        .single();
      currentTitle = (r?.title as string) || "";
      currentWhen = (r?.due_at as string) || "";
    } else if (data.source === "family_event") {
      const { data: e } = await supabaseAdmin
        .from("family_events")
        .select("title, starts_at")
        .eq("id", data.id)
        .single();
      currentTitle = (e?.title as string) || "";
      currentWhen = (e?.starts_at as string) || "";
    } else {
      const { data: j } = await supabaseAdmin
        .from("jobs")
        .select("title, scheduled_at")
        .eq("id", data.id)
        .single();
      currentTitle = (j?.title as string) || "";
      currentWhen = (j?.scheduled_at as string) || "";
    }

    const { generateObject } = await import("ai");
    const { withProviderFallback } = await import("./ai-provider.server");
    const { z: zod } = await import("zod");
    const schema = zod.object({
      title: zod.string().nullable(),
      startsAtIso: zod
        .string()
        .nullable()
        .describe("ISO datetime if date/time should change, else null"),
      notes: zod.string().nullable(),
      summary: zod.string().describe("Short confirmation in user language"),
    });

    const { object } = await withProviderFallback("chat", (model) =>
      generateObject({
        model,
        schema,
        prompt: `You help edit a calendar/task item.
Current title: ${currentTitle}
Current when: ${currentWhen}
User instruction (${data.lang ?? "th"}): ${data.instruction}
Return updated fields. Use ISO 8601 with timezone for startsAtIso when changing time. Leave null if unchanged.`,
      }),
    );

    // Apply via same rules as updateAgendaItem
    const patch: {
      source: "task" | "family_event" | "helpme";
      id: string;
      title?: string;
      startsAt?: string;
      notes?: string;
    } = { source: data.source, id: data.id };
    if (object.title) patch.title = object.title;
    if (object.startsAtIso) patch.startsAt = object.startsAtIso;
    if (object.notes) patch.notes = object.notes;

    // inline apply
    if (data.source === "task") {
      await supabaseAdmin
        .from("reminders")
        .update({
          ...(patch.title ? { title: patch.title } : {}),
          ...(patch.startsAt ? { due_at: patch.startsAt } : {}),
          ...(patch.notes ? { notes: patch.notes } : {}),
        })
        .eq("id", data.id)
        .eq("user_id", context.userId);
    } else if (data.source === "family_event") {
      await supabaseAdmin
        .from("family_events")
        .update({
          ...(patch.title ? { title: patch.title } : {}),
          ...(patch.startsAt ? { starts_at: patch.startsAt } : {}),
          ...(patch.notes ? { notes: patch.notes } : {}),
        })
        .eq("id", data.id);
    } else {
      await supabaseAdmin
        .from("jobs")
        .update({
          ...(patch.title ? { title: patch.title } : {}),
          ...(patch.startsAt ? { scheduled_at: patch.startsAt } : {}),
        })
        .eq("id", data.id)
        .eq("user_id", context.userId);
    }

    return {
      summary: object.summary,
      applied: {
        title: object.title,
        startsAt: object.startsAtIso,
        notes: object.notes,
      },
    };
  });

export const deleteAgendaItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        source: z.enum(["task", "family_event", "helpme"]),
        id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.source === "task") {
      await supabaseAdmin.from("reminders").delete().eq("id", data.id);
    } else if (data.source === "family_event") {
      await supabaseAdmin.from("family_events").delete().eq("id", data.id);
    }
    // helpme: soft cancel only
    else if (data.source === "helpme") {
      await supabaseAdmin
        .from("jobs")
        .update({ status: "cancelled" })
        .eq("id", data.id)
        .eq("user_id", context.userId);
    }
    return { ok: true as const };
  });
