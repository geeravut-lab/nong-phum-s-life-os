import { supabase } from "@/integrations/supabase/client";
import { bangkokDateTime, todayInBangkok } from "@/lib/time";

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
  /** Reminders only. */
  status?: string | null;
  query?: string | null;
};

export type AppliedAction = {
  kind: "reminder" | "expense" | "income";
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
      due_at: action.dueAt ? new Date(action.dueAt).toISOString() : null,
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
    if (action.dueAt) patch.due_at = new Date(action.dueAt).toISOString();
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

    // A new day or a new clock time both move the timestamp, and each fills
    // the half the user did not give with the current one.
    const stamp = day || action.atTime ? bangkokDateTime(day, action.atTime) : null;

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
