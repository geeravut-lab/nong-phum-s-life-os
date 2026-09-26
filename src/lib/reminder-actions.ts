import { supabase } from "@/integrations/supabase/client";
import { isRepeating, nextOccurrence } from "@/lib/recurrence";

// "Done" means two different things and the UI must say which before the tap:
//   one-off    → status = 'done', the row leaves the open list
//   recurring  → the row stays open and moves to its next occurrence after
//                now; last_completed_at records this one. Setting status =
//                'done' on a recurring reminder would end the series.
// Both Today and Tasks call this so the two pages cannot drift apart.

export type CompletableReminder = { id: string; due_at: string | null; recurrence: string };

export type CompleteResult = { advancedTo: Date | null };

export async function completeReminder(
  r: CompletableReminder,
  now: Date = new Date(),
): Promise<CompleteResult> {
  const at = now.toISOString();
  if (isRepeating(r.recurrence) && r.due_at) {
    const next = nextOccurrence(new Date(r.due_at), r.recurrence, now);
    // notified_at/notify_* are also cleared by the reminders trigger when
    // due_at changes; written here too so the intent is visible in one place.
    const { error } = await supabase
      .from("reminders")
      .update({
        due_at: next.toISOString(),
        notify_at: null,
        notified_at: null,
        notify_attempts: 0,
        notify_error: null,
        last_completed_at: at,
        status: "open",
      })
      .eq("id", r.id);
    if (error) throw error;
    return { advancedTo: next };
  }
  const { error } = await supabase
    .from("reminders")
    .update({ status: "done", last_completed_at: at })
    .eq("id", r.id);
  if (error) throw error;
  return { advancedTo: null };
}
