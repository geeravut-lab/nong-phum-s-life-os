import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isRepeating, nextOccurrence } from "@/lib/recurrence";
import { appError } from "@/lib/errors";

/**
 * Ticking a reminder off, for anyone entitled to tick it.
 *
 * This used to be an update sent with the user's own client, which meant the
 * `reminders_own` policy decided it: `user_id = auth.uid()`. A task you can
 * see because it is shared with your family, or because it was assigned to
 * you, matched no row - and PostgREST answers a zero-row update with success,
 * so the button did nothing at all and said nothing about it. The task sat
 * there overdue and the person who had actually done the job could not close
 * it.
 *
 * Who may, on a task:
 *   its owner                 - it is their task
 *   its assignee              - they are the one being asked to do it
 *   the family owner          - on a shared task; it is their household
 *   a member with             - on a shared task; the household said so
 *     can_edit_shared
 *
 * Anyone else gets a refusal rather than a shrug.
 */
const Input = z.object({
  id: z.string().uuid(),
  /** 'done' closes it; 'open' puts it back. */
  to: z.enum(["done", "open"]).default("done"),
});

export type CompleteOutcome = { advancedTo: string | null; status: "done" | "open" };

export const setReminderDone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<CompleteOutcome> => {
    const { data: row, error } = await supabaseAdmin
      .from("reminders")
      .select("id, user_id, assignee_user_id, family_id, is_shared, due_at, recurrence")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw appError("reminder_not_found");

    const uid = context.userId;
    let mayWrite = row.user_id === uid || row.assignee_user_id === uid;
    if (!mayWrite && row.is_shared && row.family_id) {
      // Whoever owns the household can close a household task. Without this a
      // task somebody else created and shared sits on everyone's list with a
      // button that refuses, which is not much better than the silence.
      const { data: fam } = await supabaseAdmin
        .from("families")
        .select("owner_id")
        .eq("id", row.family_id as string)
        .maybeSingle();
      mayWrite = fam?.owner_id === uid;
    }
    if (!mayWrite && row.is_shared && row.family_id) {
      const { data: perm } = await supabaseAdmin
        .from("family_permissions")
        .select("can_edit_shared")
        .eq("family_id", row.family_id as string)
        .eq("user_id", uid)
        .maybeSingle();
      mayWrite = perm?.can_edit_shared === true;
    }
    if (!mayWrite) throw appError("reminder_forbidden");

    const now = new Date();
    const at = now.toISOString();

    if (data.to === "open") {
      const { error: upErr } = await supabaseAdmin
        .from("reminders")
        .update({ status: "open" })
        .eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      return { advancedTo: null, status: "open" };
    }

    // "Done" means two different things and the button says which before the
    // tap: a one-off closes, a recurring one moves to its next occurrence.
    // Setting status='done' on a recurring reminder would end the series.
    if (isRepeating(row.recurrence as string) && row.due_at) {
      const next = nextOccurrence(
        new Date(row.due_at as string),
        row.recurrence as "monthly" | "yearly",
        now,
      );
      const { error: upErr } = await supabaseAdmin
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
        .eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      return { advancedTo: next.toISOString(), status: "open" };
    }

    const { error: upErr } = await supabaseAdmin
      .from("reminders")
      .update({ status: "done", last_completed_at: at })
      .eq("id", row.id);
    if (upErr) throw new Error(upErr.message);
    return { advancedTo: null, status: "done" };
  });
