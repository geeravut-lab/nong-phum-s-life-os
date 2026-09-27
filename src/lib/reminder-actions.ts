import { setReminderDone } from "@/lib/reminder.functions";

// "Done" means two different things and the UI must say which before the tap:
//   one-off    → status = 'done', the row leaves the open list
//   recurring  → the row stays open and moves to its next occurrence after
//                now; last_completed_at records this one. Setting status =
//                'done' on a recurring reminder would end the series.
// Both Today and Tasks call this so the two pages cannot drift apart.
//
// The write goes through a server function rather than the browser's own
// client. Under `reminders_own` an update only matches rows you own, so a task
// shared with your family or assigned to you matched nothing - and PostgREST
// answers a zero-row update with success, which is why the button used to do
// nothing and say nothing. The server function decides who may and refuses out
// loud when the answer is nobody.

export type CompletableReminder = { id: string; due_at: string | null; recurrence: string };

export type CompleteResult = { advancedTo: Date | null };

export async function completeReminder(r: CompletableReminder): Promise<CompleteResult> {
  const out = await setReminderDone({ data: { id: r.id, to: "done" } });
  return { advancedTo: out.advancedTo ? new Date(out.advancedTo) : null };
}

/** Put a finished task back on the open list. */
export async function reopenReminder(id: string): Promise<void> {
  await setReminderDone({ data: { id, to: "open" } });
}
