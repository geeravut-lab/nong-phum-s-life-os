import { supabase } from "@/integrations/supabase/client";

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

const today = () => new Date().toISOString().slice(0, 10);

/** Saves the action Nong Phum decided on straight into the matching module. */
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
