import { supabase } from "@/integrations/supabase/client";
import { todayInBangkok } from "@/lib/time";

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
  query?: string | null;
};

export type AppliedAction = { kind: "reminder" | "expense" | "income"; label: string };

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
    return { kind: "reminder", label: action.title };
  }

  if (action.type === "add_expense" && action.amount != null) {
    const { error } = await supabase.from("expenses").insert({
      user_id: userId,
      title: action.title ?? "-",
      amount: action.amount,
      category: action.category ?? "other",
      spent_on: action.spentOn ?? today(),
    });
    if (error) throw error;
    return { kind: "expense", label: `${action.title ?? "-"} · ${action.amount}` };
  }

  if (action.type === "add_income" && action.amount != null) {
    const { error } = await supabase.from("incomes").insert({
      user_id: userId,
      title: action.title ?? "-",
      amount: action.amount,
      category: action.category ?? "other",
      received_on: action.receivedOn ?? action.spentOn ?? today(),
    });
    if (error) throw error;
    return { kind: "income", label: `${action.title ?? "-"} · ${action.amount}` };
  }

  return null;
}
