import { supabase } from "@/integrations/supabase/client";
import { bangkokDateTime, bangkokIsoFromLoose, bangkokTimeOf, todayInBangkok } from "@/lib/time";

export type PhumActionPayload = {
  type: string;
  title?: string | null;
  dueAt?: string | null;
  priority?: string | null;
  recurrence?: string | null;
  amount?: number | null;
  category?: string | null;
  spentOn?: string | null;
  receivedOn?: string | null;
  /** HH:mm, only when the user said a time of day. */
  atTime?: string | null;
  /** The row to change or remove, for the update_* and delete_* types. */
  targetId?: string | null;
  /** The family member an action is about. */
  memberId?: string | null;
  everyDays?: number | null;
  graceDays?: number | null;
  /** Reminders only. */
  status?: string | null;
  query?: string | null;
};

export type AppliedAction = {
  kind: "reminder" | "expense" | "income" | "family";
  /** What happened to it, so the caller can say "saved" or "removed". */
  verb: "saved" | "updated" | "deleted";
  label: string;
};

const today = () => todayInBangkok();

/**
 * Saves every action Nong Phum decided on, in order, and reports what landed.
 *
 * One message can carry more than one record - an expense and a reminder - so
 * this returns a list. A failure on one is not allowed to lose the others: the
 * ones already saved are kept and the error is rethrown after, so the caller
 * can say what did and did not happen.
 */
export async function applyPhumActions(
  actions: PhumActionPayload[] | PhumActionPayload | null | undefined,
  userId: string,
): Promise<AppliedAction[]> {
  const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
  const applied: AppliedAction[] = [];
  for (const a of list) {
    const one = await applyPhumAction(a, userId);
    if (one) applied.push(one);
  }
  return applied;
}

/**
 * PostgREST refuses the whole insert when one column is not in its schema
 * cache, and the site deploys before anyone runs the migration. Without this,
 * every expense and income spoken into the chat would be lost for the length
 * of that window - the row rejected, nothing saved, and the person told
 * nothing useful. Drop the new column and save the rest; the time of day is
 * worth having, not worth losing the expense over.
 */
function missingColumn(error: { code?: string; message?: string } | null, column: string) {
  if (!error) return false;
  return (
    (error.code === "PGRST204" || error.code === "42703") && (error.message ?? "").includes(column)
  );
}

/** Saves one action straight into the matching module. */
export async function applyPhumAction(
  action: PhumActionPayload | null | undefined,
  userId: string,
): Promise<AppliedAction | null> {
  if (!action) return null;

  if (action.type === "create_reminder" && action.title) {
    const { error } = await supabase.from("reminders").insert({
      user_id: userId,
      title: action.title,
      due_at: action.dueAt ? bangkokIsoFromLoose(action.dueAt) : null,
      priority: action.priority ?? "normal",
      recurrence: action.recurrence ?? "none",
    });
    if (error) throw error;
    return { kind: "reminder", verb: "saved", label: action.title };
  }

  if (action.type === "add_expense" && action.amount != null) {
    const base = {
      user_id: userId,
      title: action.title ?? "-",
      amount: action.amount,
      category: action.category ?? "other",
      // The date still drives monthly totals and the budget, so it keeps its
      // own column. spent_at carries the time of day the user actually said,
      // filling in today and the current clock for whichever half they left
      // out - so "80 on lunch at 5.15" lands at 17:15 today, not at midnight.
      spent_on: action.spentOn ?? today(),
    };
    let { error } = await supabase
      .from("expenses")
      .insert({ ...base, spent_at: bangkokDateTime(action.spentOn, action.atTime) });
    if (missingColumn(error, "spent_at")) {
      ({ error } = await supabase.from("expenses").insert(base));
    }
    if (error) throw error;
    return { kind: "expense", verb: "saved", label: `${action.title ?? "-"} · ${action.amount}` };
  }

  if (action.type === "add_income" && action.amount != null) {
    const base = {
      user_id: userId,
      title: action.title ?? "-",
      amount: action.amount,
      category: action.category ?? "other",
      received_on: action.receivedOn ?? action.spentOn ?? today(),
    };
    let { error } = await supabase.from("incomes").insert({
      ...base,
      received_at: bangkokDateTime(action.receivedOn ?? action.spentOn, action.atTime),
    });
    if (missingColumn(error, "received_at")) {
      ({ error } = await supabase.from("incomes").insert(base));
    }
    if (error) throw error;
    return { kind: "income", verb: "saved", label: `${action.title ?? "-"} · ${action.amount}` };
  }

  // --- the family page, by asking --------------------------------------------
  //
  // These go through the server functions rather than writing the tables
  // directly: that is where membership is checked, where the assignee is told,
  // and where the family calendar and the routine tracker agree on what a row
  // means. The family id is looked up here rather than taken from the model -
  // it is not something a sentence should be able to choose.

  if (
    action.type === "family_assign_task" ||
    action.type === "family_add_event" ||
    action.type === "family_add_routine"
  ) {
    const { data: membership } = await supabase
      .from("family_members")
      .select("family_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const familyId = (membership?.family_id as string | undefined) ?? undefined;
    // The prompt tells the model to say so rather than return the action, but
    // a family can also be left between the message and the write.
    if (!familyId) throw new Error("no_family");

    const title = action.title?.trim();
    if (!title) return null;

    if (action.type === "family_assign_task") {
      const { assignFamilyTask } = await import("./family.functions");
      await assignFamilyTask({
        data: {
          familyId,
          title,
          ...(action.dueAt ? { dueAt: bangkokIsoFromLoose(action.dueAt) } : {}),
          ...(action.memberId ? { assigneeUserId: action.memberId } : {}),
        },
      });
      return { kind: "family", verb: "saved", label: title };
    }

    if (action.type === "family_add_event") {
      const { createFamilyEvent } = await import("./family.functions");
      await createFamilyEvent({
        data: {
          familyId,
          title,
          startsAt: bangkokIsoFromLoose(action.dueAt ?? new Date().toISOString()),
        },
      });
      return { kind: "family", verb: "saved", label: title };
    }

    const { upsertFamilyRoutine } = await import("./routines.functions");
    await upsertFamilyRoutine({
      data: {
        familyId,
        // Tracking somebody needs a somebody; with nobody named, the person
        // asking is the one being tracked.
        subjectUserId: action.memberId ?? userId,
        title,
        intervalDays: Math.min(90, Math.max(1, action.everyDays ?? 1)),
        graceDays: Math.min(30, Math.max(0, action.graceDays ?? 1)),
      },
    });
    return { kind: "family", verb: "saved", label: title };
  }

  // --- changing and removing what is already there ---------------------------
  //
  // Every write is scoped to the caller as well as to the id. The row policy
  // already does that, but a targetId is the one field here that comes
  // straight from a model reading a list, so it is worth not depending on a
  // single gate.

  if (action.type === "delete_reminder" && action.targetId) {
    const { error } = await supabase
      .from("reminders")
      .delete()
      .eq("id", action.targetId)
      .eq("user_id", userId);
    if (error) throw error;
    return { kind: "reminder", verb: "deleted", label: action.title ?? "" };
  }

  if (action.type === "update_reminder" && action.targetId) {
    // Only what the user actually changed. A null means "leave it", not
    // "clear it" - the model is told to send nulls for everything else.
    const patch: {
      title?: string;
      due_at?: string;
      priority?: string;
      recurrence?: string;
      status?: string;
    } = {};
    if (action.title) patch.title = action.title;
    if (action.dueAt) patch.due_at = bangkokIsoFromLoose(action.dueAt);
    if (action.priority) patch.priority = action.priority;
    if (action.recurrence) patch.recurrence = action.recurrence;
    if (action.status) patch.status = action.status;
    if (Object.keys(patch).length === 0) return null;
    const { error } = await supabase
      .from("reminders")
      .update(patch)
      .eq("id", action.targetId)
      .eq("user_id", userId);
    if (error) throw error;
    return { kind: "reminder", verb: "updated", label: action.title ?? "" };
  }

  if (action.type === "delete_expense" && action.targetId) {
    const { error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", action.targetId)
      .eq("user_id", userId);
    if (error) throw error;
    return { kind: "expense", verb: "deleted", label: action.title ?? "" };
  }

  if (action.type === "delete_income" && action.targetId) {
    const { error } = await supabase
      .from("incomes")
      .delete()
      .eq("id", action.targetId)
      .eq("user_id", userId);
    if (error) throw error;
    return { kind: "income", verb: "deleted", label: action.title ?? "" };
  }

  if ((action.type === "update_expense" || action.type === "update_income") && action.targetId) {
    const isExpense = action.type === "update_expense";
    const day = action.spentOn ?? action.receivedOn ?? null;

    const patch: { title?: string; amount?: number; category?: string } = {};
    if (action.title) patch.title = action.title;
    if (action.amount != null) patch.amount = action.amount;
    if (action.category) patch.category = action.category;
    if (Object.keys(patch).length === 0 && !day && !action.atTime) return null;

    /**
     * The timestamp of a row that already has one.
     *
     * bangkokDateTime fills whichever half the user left out with *now*, which
     * is the agreed rule for a new row ("วันอย่างเดียว = วันที่บอก + เวลาปัจจุบัน").
     * On an edit it is wrong: asked to change 24 Sept's coffee from 60 to 120,
     * the model also reports the day it matched on, and the row's 15:30 was
     * being overwritten with the time the user happened to be typing. The time
     * is only touched when the user actually gave one.
     *
     * So each half is taken from the user if given, and from the row otherwise:
     *   day + time  → both change
     *   time only   → the clock changes, the date stays
     *   day only    → the date changes, the clock stays
     *   neither     → the timestamp is not written at all
     */
    const timeCol = isExpense ? "spent_at" : "received_at";
    let stamp: string | null = null;
    if (day || action.atTime) {
      const { data: current } = await supabase
        .from(isExpense ? "expenses" : "incomes")
        .select(`${isExpense ? "spent_on" : "received_on"}, ${timeCol}`)
        .eq("id", action.targetId as string)
        .eq("user_id", userId)
        .maybeSingle();
      const row = (current ?? {}) as Record<string, string | null>;
      const existing = row[timeCol] ?? null;
      stamp = bangkokDateTime(
        day ?? row[isExpense ? "spent_on" : "received_on"] ?? null,
        action.atTime ?? (existing ? bangkokTimeOf(existing) : null),
      );
    }

    const run = (withTime: boolean) => {
      const q = isExpense
        ? supabase.from("expenses").update({
            ...patch,
            ...(day ? { spent_on: day } : {}),
            ...(withTime && stamp ? { spent_at: stamp } : {}),
          })
        : supabase.from("incomes").update({
            ...patch,
            ...(day ? { received_on: day } : {}),
            ...(withTime && stamp ? { received_at: stamp } : {}),
          });
      return q.eq("id", action.targetId as string).eq("user_id", userId);
    };

    let { error } = await run(true);
    if (missingColumn(error, isExpense ? "spent_at" : "received_at")) {
      ({ error } = await run(false));
    }
    if (error) throw error;
    return {
      kind: isExpense ? "expense" : "income",
      verb: "updated",
      label: action.title ?? "",
    };
  }

  return null;
}
