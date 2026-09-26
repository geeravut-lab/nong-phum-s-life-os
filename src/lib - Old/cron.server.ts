// The scheduled tick (netlify/functions/tick.mts) calls runTick() every five
// minutes. Everything the tick does lives here so it can also be run from a
// script against a database, which is how it is tested — Netlify Dev does not
// execute schedules and `netlify functions:invoke` needs an interactive login.
//
// Imports are relative on purpose: this module is bundled by Netlify's
// esbuild for the function, not by Vite, and the "@/" alias is a tsconfig
// convenience the function bundle should not have to depend on.
//
// Rules every step follows:
//   * idempotent — the same minute can be invoked twice (Netlify retry, a
//     "Run now" from the UI); cron_ticks (job, tick) is the lock, and each
//     step deletes only what still matches its cutoff
//   * bounded — free-plan functions are killed at 30 s, so steps take small
//     batches and the loop stops early when the budget is nearly spent; the
//     next tick continues
//   * files before rows — a documents row is deleted only after its storage
//     object is gone, so a crash in between leaves a row without a file
//     (harmless, deleted next tick) rather than a file without a row
//
// Reminder engine (phase 1.3 step 3). Per occurrence, exactly once:
//   1. claim  — UPDATE reminders SET notified_at = now() WHERE id = ? AND
//               notified_at IS NULL, RETURNING; zero rows = someone else won
//   2. log    — one notification_log row; 'immediate' for priority = 'high',
//               otherwise appended to the user's 'digest' row for today.
//               channel = 'line' + status 'queued' when the user has a LINE
//               link and is a friend of the OA, else 'none' + 'skipped'
//               (in-app only). Delivery, retries and the quota guard live in
//               line-deliver.server.ts and run right after, in the same tick.
// A recurring reminder is NOT advanced here. It stays open — and visibly
// overdue on Today — until the user marks it done, which moves it to the next
// occurrence (src/lib/recurrence.ts). The one exception is rolloverStale():
// if a whole period passes with the occurrence still not completed, the tick
// advances it anyway so a user who only ever reads the notification (never
// opens the app) keeps getting one per period instead of falling silent.
import { supabaseAdmin } from "../integrations/supabase/client.server";
import { isRepeating, lastOccurrenceAtOrBefore, nextOccurrence } from "./recurrence";
import { bangkokDateAtHour, todayInBangkok } from "./time";
import {
  bangkokHour,
  deliverQueued,
  ensureFriend,
  linkFor,
  loadLineContext,
  targetDigestDate,
  type LineContext,
} from "./line-deliver.server";
import {
  AI_EVENT_RETENTION_DAYS,
  CRON_TICK_RETENTION_DAYS,
  FAILED_DOC_RETENTION_DAYS,
  NOTIFICATION_LOG_RETENTION_DAYS,
  PENDING_DOC_RETENTION_HOURS,
} from "./retention";

const JOB = "tick";
// Netlify's synchronous limit is 30 s; leave room to write the run log.
const TIME_BUDGET_MS = 24_000;
// Documents are deleted one at a time (storage call + row), so cap per tick.
const DOC_BATCH = 20;
// Reminders are claimed one at a time (claim + log), same cap.
const REMINDER_BATCH = 20;

export type TickSummary = Record<string, number | string>;

export type TickResult =
  | { skipped: true; reason: "already_running" }
  | { skipped: false; tick: string; summary: TickSummary; error: string | null };

function minuteFloor(d: Date): string {
  const m = new Date(d);
  m.setUTCSeconds(0, 0);
  return m.toISOString();
}

function agoIso(now: Date, ms: number): string {
  return new Date(now.getTime() - ms).toISOString();
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * One run of the scheduled job. `now` is injectable so a test can pretend to
 * be a different minute (a second call with the same `now` must skip).
 */
export async function runTick(now: Date = new Date()): Promise<TickResult> {
  const tick = minuteFloor(now);
  const started = Date.now();
  const overBudget = () => Date.now() - started > TIME_BUDGET_MS;

  // Lock. A duplicate key here means another invocation owns this minute.
  const { error: lockErr } = await supabaseAdmin.from("cron_ticks").insert({ job: JOB, tick });
  if (lockErr) {
    if (lockErr.code === "23505") return { skipped: true, reason: "already_running" };
    throw new Error(`cron_ticks lock: ${lockErr.message}`);
  }

  const summary: TickSummary = {};
  let error: string | null = null;
  try {
    const line = await loadLineContext(now, summary);
    const steps: Array<[string, () => Promise<number>]> = [
      // Reminders first: a notification a few seconds late matters more than
      // a stale ai_events row surviving one more tick.
      ["reminders_rolled_over", () => rolloverStale(now, overBudget)],
      ["reminders_notified", () => notifyDue(now, overBudget, summary, line)],
      ["digest_lookahead_claimed", () => claimForDigest(line, overBudget)],
      ["line_sent", () => deliverQueued(line, overBudget)],
      [
        "ai_events_deleted",
        () =>
          deleteOlderThan("ai_events", "created_at", agoIso(now, AI_EVENT_RETENTION_DAYS * DAY)),
      ],
      [
        "failed_docs_deleted",
        () => deleteDocuments("failed", agoIso(now, FAILED_DOC_RETENTION_DAYS * DAY), summary),
      ],
      [
        "pending_docs_deleted",
        () => deleteDocuments("pending", agoIso(now, PENDING_DOC_RETENTION_HOURS * HOUR), summary),
      ],
      [
        "notification_log_deleted",
        () =>
          deleteOlderThan(
            "notification_log",
            "created_at",
            agoIso(now, NOTIFICATION_LOG_RETENTION_DAYS * DAY),
          ),
      ],
      [
        "cron_ticks_deleted",
        () =>
          deleteOlderThan("cron_ticks", "started_at", agoIso(now, CRON_TICK_RETENTION_DAYS * DAY)),
      ],
      ["orphan_attachments_deleted", () => deleteOrphanAttachments(now, overBudget, summary)],
      // Abandoned LINE link flows: the state is useless once expired.
      [
        "line_states_deleted",
        () => deleteOlderThan("line_link_states", "expires_at", now.toISOString()),
      ],
    ];
    for (const [key, step] of steps) {
      if (overBudget()) {
        summary["stopped_early_at"] = key;
        break;
      }
      summary[key] = await step();
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  summary["duration_ms"] = Date.now() - started;
  const { error: doneErr } = await supabaseAdmin
    .from("cron_ticks")
    .update({ finished_at: new Date().toISOString(), summary, error })
    .eq("job", JOB)
    .eq("tick", tick);
  if (doneErr) console.error(`[tick] could not write run log: ${doneErr.message}`);

  return { skipped: false, tick, summary, error };
}

type RetentionTable = "ai_events" | "notification_log" | "cron_ticks" | "line_link_states";

/** Plain row retention: delete everything whose timestamp column is before the cutoff. */
async function deleteOlderThan(
  table: RetentionTable,
  column: string,
  cutoff: string,
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .delete({ count: "exact" })
    .lt(column, cutoff);
  if (error) throw new Error(`${table} retention: ${error.message}`);
  return count ?? 0;
}

/**
 * Removes documents in the given status whose updated_at is before the
 * cutoff — storage object first, then the row. A row whose file cannot be
 * removed is left alone (and counted in summary.doc_errors) so the next tick
 * tries again; nothing here can create a file without a row.
 */
async function deleteDocuments(
  status: "failed" | "pending",
  cutoff: string,
  summary: TickSummary,
): Promise<number> {
  const { data: rows, error } = await supabaseAdmin
    .from("documents")
    .select("id, storage_path")
    .eq("status", status)
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(DOC_BATCH);
  if (error) throw new Error(`documents(${status}) select: ${error.message}`);

  let deleted = 0;
  for (const row of rows ?? []) {
    if (row.storage_path) {
      // remove() succeeds for a path that no longer exists, which is what we
      // want: a row left behind by an earlier crash still gets cleaned up.
      const { error: rmErr } = await supabaseAdmin.storage
        .from("documents")
        .remove([row.storage_path]);
      if (rmErr) {
        console.error(`[tick] could not remove ${row.storage_path}: ${rmErr.message}`);
        summary["doc_errors"] = Number(summary["doc_errors"] ?? 0) + 1;
        continue;
      }
    }
    const { error: delErr } = await supabaseAdmin.from("documents").delete().eq("id", row.id);
    if (delErr) {
      console.error(`[tick] could not delete documents row ${row.id}: ${delErr.message}`);
      summary["doc_errors"] = Number(summary["doc_errors"] ?? 0) + 1;
      continue;
    }
    deleted += 1;
  }
  return deleted;
}

type DueReminder = {
  id: string;
  user_id: string;
  title: string;
  due_at: string | null;
  notify_at: string | null;
  priority: string;
  recurrence: string;
  notified_at: string | null;
};

const REMINDER_COLUMNS = "id, user_id, title, due_at, notify_at, priority, recurrence, notified_at";

/**
 * Open reminders whose COALESCE(notify_at, due_at) has passed and that nobody
 * has claimed yet. Claim each, then write the log row. Returns how many were
 * claimed by this run.
 */
async function notifyDue(
  now: Date,
  overBudget: () => boolean,
  summary: TickSummary,
  line: LineContext,
): Promise<number> {
  const nowIso = now.toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from("reminders")
    .select(REMINDER_COLUMNS)
    .eq("status", "open")
    .is("notified_at", null)
    .or(`notify_at.lte.${nowIso},and(notify_at.is.null,due_at.lte.${nowIso})`)
    .order("due_at", { ascending: true })
    .limit(REMINDER_BATCH);
  if (error) throw new Error(`reminders select: ${error.message}`);

  let claimed = 0;
  for (const r of (rows ?? []) as DueReminder[]) {
    if (overBudget()) {
      summary["stopped_early_at"] = "reminders_notified";
      break;
    }
    // Atomic claim: the WHERE repeats the "not yet notified" condition, so of
    // two runs racing for the same row exactly one gets it back.
    const { data: won, error: claimErr } = await supabaseAdmin
      .from("reminders")
      .update({ notified_at: nowIso })
      .eq("id", r.id)
      .is("notified_at", null)
      .select("id");
    if (claimErr) throw new Error(`reminders claim ${r.id}: ${claimErr.message}`);
    if (!won?.length) continue;
    claimed += 1;

    // 'line'/'queued' when the user can be reached on LINE, else 'none'/
    // 'skipped': the row still records that the occurrence came due.
    const reach = await reachable(line, r.user_id);
    if (r.priority === "high") {
      const { error: logErr } = await supabaseAdmin.from("notification_log").insert({
        user_id: r.user_id,
        kind: "immediate",
        reminder_id: r.id,
        due_at: r.due_at ?? nowIso,
        reminder_ids: [r.id],
        channel: reach ? "line" : "none",
        status: reach ? "queued" : "skipped",
      });
      // 23505 = this occurrence was logged by a run that died after sending;
      // the claim above already prevents a second delivery, so just move on.
      if (logErr && logErr.code !== "23505")
        throw new Error(`notification_log insert: ${logErr.message}`);
    } else {
      await appendToDigest(r.user_id, r.id, await targetDigestDate(r.user_id, now), reach);
    }
  }
  return claimed;
}

/**
 * One digest row per user per Bangkok day accumulates every non-urgent
 * reminder that came due that day. Insert first (it is the claim on the day);
 * on conflict, append to the existing row's reminder_ids.
 */
/** Has a LINE link and is a friend of the OA (checked, cached per tick). */
async function reachable(line: LineContext, userId: string): Promise<boolean> {
  if (!line.token) return false;
  const link = await linkFor(line, userId);
  if (!link) return false;
  return ensureFriend(line, link);
}

async function appendToDigest(
  userId: string,
  reminderId: string,
  digestDate: string,
  reach: boolean,
): Promise<void> {
  const { error: insErr } = await supabaseAdmin.from("notification_log").insert({
    user_id: userId,
    kind: "digest",
    digest_date: digestDate,
    reminder_ids: [reminderId],
    channel: reach ? "line" : "none",
    status: reach ? "queued" : "skipped",
  });
  if (!insErr) return;
  if (insErr.code !== "23505") throw new Error(`digest insert: ${insErr.message}`);

  const { data: existing, error: selErr } = await supabaseAdmin
    .from("notification_log")
    .select("id, reminder_ids")
    .eq("kind", "digest")
    .eq("user_id", userId)
    .eq("digest_date", digestDate)
    .single();
  if (selErr) throw new Error(`digest select: ${selErr.message}`);
  if (existing.reminder_ids.includes(reminderId)) return;
  const { error: updErr } = await supabaseAdmin
    .from("notification_log")
    .update({ reminder_ids: [...existing.reminder_ids, reminderId] })
    .eq("id", existing.id);
  if (updErr) throw new Error(`digest append: ${updErr.message}`);
}

/**
 * Recurring reminders that were notified but never completed for a whole
 * period: move them to the latest occurrence at or before now and clear the
 * claim, so notifyDue (which runs right after) tells the user again. The
 * candidate query over-selects by period length; the exact check is in JS.
 */
async function rolloverStale(now: Date, overBudget: () => boolean): Promise<number> {
  const { data: rows, error } = await supabaseAdmin
    .from("reminders")
    .select(REMINDER_COLUMNS)
    .eq("status", "open")
    .not("notified_at", "is", null)
    .in("recurrence", ["monthly", "yearly"])
    .lte("due_at", new Date(now.getTime() - 28 * DAY).toISOString())
    .order("due_at", { ascending: true })
    .limit(REMINDER_BATCH);
  if (error) throw new Error(`reminders rollover select: ${error.message}`);

  let rolled = 0;
  for (const r of (rows ?? []) as DueReminder[]) {
    if (overBudget() || !r.due_at || !isRepeating(r.recurrence)) continue;
    const due = new Date(r.due_at);
    // Only once the next occurrence in the series has itself arrived.
    if (nextOccurrence(due, r.recurrence, due).getTime() > now.getTime()) continue;
    const catchUp = lastOccurrenceAtOrBefore(due, r.recurrence, now);
    const { error: updErr } = await supabaseAdmin
      .from("reminders")
      .update({
        due_at: catchUp.toISOString(),
        notify_at: null,
        notified_at: null,
        notify_attempts: 0,
        notify_error: null,
      })
      .eq("id", r.id)
      .eq("due_at", r.due_at); // no-op if the user touched it meanwhile
    if (updErr) throw new Error(`reminders rollover ${r.id}: ${updErr.message}`);
    rolled += 1;
  }
  return rolled;
}

/**
 * Morning digest look-ahead. From the digest hour on, a LINE user's non-urgent
 * reminders due later TODAY are claimed now and put into today's digest, so
 * the one message of the day says "today: rent at 15:00" instead of arriving
 * after the fact. Users without LINE are left to notifyDue (nothing would be
 * sent anyway, and Today already shows their items).
 */
async function claimForDigest(line: LineContext, overBudget: () => boolean): Promise<number> {
  if (!line.token || bangkokHour(line.now) < line.settings.line_digest_hour) return 0;
  const today = todayInBangkok(line.now);
  const endOfToday = new Date(bangkokDateAtHour(today, 0));
  endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);

  const { data: links, error: linkErr } = await supabaseAdmin
    .from("line_links")
    .select("user_id, line_user_id, is_friend, friend_checked_at, blocked_at")
    .eq("is_friend", true)
    .is("blocked_at", null);
  if (linkErr) throw new Error(`line_links list: ${linkErr.message}`);

  let claimed = 0;
  for (const link of links ?? []) {
    if (overBudget()) break;
    line.links.set(link.user_id, link);
    const { data: rows, error } = await supabaseAdmin
      .from("reminders")
      .select("id, due_at")
      .eq("user_id", link.user_id)
      .eq("status", "open")
      .is("notified_at", null)
      .neq("priority", "high")
      .not("due_at", "is", null)
      .lt("due_at", endOfToday.toISOString())
      .limit(REMINDER_BATCH);
    if (error) throw new Error(`digest lookahead select: ${error.message}`);
    for (const r of rows ?? []) {
      const { data: won } = await supabaseAdmin
        .from("reminders")
        .update({ notified_at: line.now.toISOString() })
        .eq("id", r.id)
        .is("notified_at", null)
        .select("id");
      if (!won?.length) continue;
      await appendToDigest(
        link.user_id,
        r.id,
        await targetDigestDate(link.user_id, line.now),
        true,
      );
      claimed += 1;
    }
  }
  return claimed;
}

/**
 * Attachments (documents.kind = 'attachment', phase 1.9) exist only for the
 * expense / income / reminder that points at them. The foreign keys run the
 * other way (row → document, ON DELETE SET NULL), so deleting the owning row
 * — from any future UI, the SQL editor, anywhere — would leave the receipt
 * behind with nothing pointing at it. This step removes such files after a
 * day's grace (a just-uploaded file may not be linked yet), file first, then
 * row, like the other document cleanups.
 */
async function deleteOrphanAttachments(
  now: Date,
  overBudget: () => boolean,
  summary: TickSummary,
): Promise<number> {
  const { data: rows, error } = await supabaseAdmin
    .from("documents")
    .select("id, storage_path")
    .eq("kind", "attachment")
    .eq("status", "ready")
    .lt("created_at", agoIso(now, 1 * DAY))
    .order("created_at", { ascending: true })
    .limit(DOC_BATCH);
  if (error) throw new Error(`orphan attachments select: ${error.message}`);

  let deleted = 0;
  for (const doc of rows ?? []) {
    if (overBudget()) {
      summary["stopped_early_at"] = "orphan_attachments_deleted";
      break;
    }
    let referenced = false;
    for (const table of ["expenses", "incomes", "reminders"] as const) {
      const { count, error: cErr } = await supabaseAdmin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("source_document_id", doc.id);
      if (cErr) throw new Error(`orphan check ${table}: ${cErr.message}`);
      if ((count ?? 0) > 0) {
        referenced = true;
        break;
      }
    }
    if (referenced) continue;
    if (doc.storage_path) {
      const { error: rmErr } = await supabaseAdmin.storage
        .from("documents")
        .remove([doc.storage_path]);
      if (rmErr) {
        console.error(
          `[tick] could not remove orphan attachment ${doc.storage_path}: ${rmErr.message}`,
        );
        summary["doc_errors"] = Number(summary["doc_errors"] ?? 0) + 1;
        continue;
      }
    }
    const { error: delErr } = await supabaseAdmin.from("documents").delete().eq("id", doc.id);
    if (delErr) {
      console.error(`[tick] could not delete orphan attachment row ${doc.id}: ${delErr.message}`);
      summary["doc_errors"] = Number(summary["doc_errors"] ?? 0) + 1;
      continue;
    }
    deleted += 1;
  }
  return deleted;
}
