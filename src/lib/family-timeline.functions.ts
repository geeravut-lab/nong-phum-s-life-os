import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Family Timeline: what happened in this family, newest first.
 *
 * The family page answers "what is true now" - who is in it, what is shared,
 * which routines are overdue. It cannot answer "what has been going on", which
 * is the question someone asks after a week away, so every module that records
 * something dated is merged into one list here.
 *
 * Read with the service role because it crosses six tables, so membership is
 * checked once up front and every query is then pinned to that family id.
 */

export type TimelineKind = "event" | "checkin" | "routine_log" | "task" | "expense" | "document";

export type TimelineItem = {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string;
  /** Whose entry it is, resolved to a name where we have one. */
  who: string | null;
  href: string;
};

export const getFamilyTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ days: z.number().int().min(1).max(365).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: membership } = await supabaseAdmin
      .from("family_members")
      .select("family_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const familyId = membership?.family_id as string | undefined;
    if (!familyId) return { items: [] as TimelineItem[], familyId: null };

    const since = new Date(Date.now() - (data.days ?? 30) * 86400000).toISOString();

    const [members, events, checkins, routines, logs, tasks, expenses, docs] = await Promise.all([
      supabaseAdmin.from("family_members").select("user_id").eq("family_id", familyId),
      supabaseAdmin
        .from("family_events")
        .select("id, title, starts_at, created_by, created_at")
        .eq("family_id", familyId)
        .gte("created_at", since),
      supabaseAdmin
        .from("family_checkins")
        .select("id, user_id, status, note, created_at")
        .eq("family_id", familyId)
        .gte("created_at", since),
      supabaseAdmin
        .from("family_routines")
        .select("id, title, subject_user_id")
        .eq("family_id", familyId),
      supabaseAdmin
        .from("routine_logs")
        .select("id, routine_id, logged_on, logged_by, note, created_at")
        .gte("created_at", since),
      supabaseAdmin
        .from("reminders")
        .select("id, title, due_at, status, user_id, assignee_user_id, updated_at")
        .eq("family_id", familyId)
        .eq("is_shared", true)
        .gte("updated_at", since),
      supabaseAdmin
        .from("expenses")
        .select("id, title, amount, spent_on, user_id, created_at")
        .eq("family_id", familyId)
        .eq("is_shared", true)
        .gte("created_at", since),
      supabaseAdmin
        .from("documents")
        .select("id, title, category, user_id, created_at")
        .eq("family_id", familyId)
        .eq("is_shared", true)
        .gte("created_at", since),
    ]);

    const memberIds = (members.data ?? []).map((m) => m.user_id as string);
    const { data: profiles } = memberIds.length
      ? await supabaseAdmin.from("profiles").select("id, display_name").in("id", memberIds)
      : { data: [] as Array<{ id: string; display_name: string | null }> };
    const nameOf = (uid: string | null | undefined) =>
      uid ? ((profiles ?? []).find((p) => p.id === uid)?.display_name ?? null) : null;

    // Routine logs carry no family id of their own, so they are matched through
    // the routines of this family rather than filtered in the query.
    const routineById = new Map(
      (routines.data ?? []).map((r) => [
        r.id as string,
        r as { title: string; subject_user_id: string },
      ]),
    );

    const items: TimelineItem[] = [
      ...(events.data ?? []).map((e) => ({
        id: `event:${e.id}`,
        kind: "event" as const,
        at: e.created_at as string,
        title: e.title as string,
        detail: new Date(e.starts_at as string).toISOString(),
        who: nameOf(e.created_by as string | null),
        href: "/family",
      })),
      ...(checkins.data ?? []).map((c) => ({
        id: `checkin:${c.id}`,
        kind: "checkin" as const,
        at: c.created_at as string,
        title: (c.status as string) ?? "",
        detail: (c.note as string) ?? "",
        who: nameOf(c.user_id as string),
        href: "/family",
      })),
      ...(logs.data ?? [])
        .filter((l) => routineById.has(l.routine_id as string))
        .map((l) => ({
          id: `log:${l.id}`,
          kind: "routine_log" as const,
          at: l.created_at as string,
          title: routineById.get(l.routine_id as string)?.title ?? "",
          detail: (l.logged_on as string) ?? "",
          who: nameOf(l.logged_by as string | null),
          href: "/family",
        })),
      ...(tasks.data ?? []).map((r) => ({
        id: `task:${r.id}`,
        kind: "task" as const,
        at: r.updated_at as string,
        title: r.title as string,
        detail: (r.status as string) ?? "",
        who: nameOf((r.assignee_user_id as string | null) ?? (r.user_id as string)),
        href: "/tasks",
      })),
      ...(expenses.data ?? []).map((x) => ({
        id: `expense:${x.id}`,
        kind: "expense" as const,
        at: x.created_at as string,
        title: x.title as string,
        detail: String(x.amount ?? ""),
        who: nameOf(x.user_id as string),
        href: "/money",
      })),
      ...(docs.data ?? []).map((d) => ({
        id: `doc:${d.id}`,
        kind: "document" as const,
        at: d.created_at as string,
        title: d.title as string,
        detail: (d.category as string) ?? "",
        who: nameOf(d.user_id as string),
        href: "/docs",
      })),
    ]
      .filter((i) => !!i.at)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, 200);

    return { items, familyId };
  });
