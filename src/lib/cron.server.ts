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
import { loadRules, recordRuleRun, ruleEnabled, ruleNumber, type RuleSet } from "./rules.server";
import { notifyUsers } from "./notify.server";
import { isRepeating, lastOccurrenceAtOrBefore, nextOccurrence } from "./recurrence";
import { bahtTH, dayTH, noticeBody, whenTH } from "./notice-detail";
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

/** A name for a notification, never a reason for one to fail. */
async function userLabelSafe(userId: string | null | undefined): Promise<string> {
  if (!userId) return "";
  try {
    const { userLabel } = await import("./family-labels.server");
    return await userLabel(userId);
  } catch {
    return "";
  }
}

/** "฿500 - ฿800", or one end of it, or nothing when the poster gave neither. */
function budgetText(min: number | null, max: number | null): string {
  const lo = bahtTH(min);
  const hi = bahtTH(max);
  if (lo && hi) return lo === hi ? lo : `${lo} - ${hi}`;
  return lo || hi || "";
}

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
    // Which rules are on, and the numbers inside them. A rule with no row runs
    // with the value it was written with, so a missing table never silences the
    // engine - see rules.server.ts.
    const rules = await loadRules();
    const line = await loadLineContext(now, summary);
    const steps: Array<[string, () => Promise<number>]> = [
      // Reminders first: a notification a few seconds late matters more than
      // a stale ai_events row surviving one more tick.
      ["reminders_rolled_over", () => rolloverStale(now, overBudget)],
      ["reminders_notified", () => notifyDue(now, overBudget, summary, line)],
      ["digest_lookahead_claimed", () => claimForDigest(line, overBudget)],
      ["routine_changes_alerted", () => detectRoutineChanges(now, overBudget)],
      ["line_sent", () => deliverQueued(line, overBudget)],
      [
        "ai_events_deleted",
        () =>
          deleteOlderThan(
            "ai_events",
            "created_at",
            agoIso(
              now,
              ruleNumber(rules, "ai_events_deleted", "days", AI_EVENT_RETENTION_DAYS) * DAY,
            ),
          ),
      ],
      [
        "failed_docs_deleted",
        () =>
          deleteDocuments(
            "failed",
            agoIso(
              now,
              ruleNumber(rules, "failed_docs_deleted", "days", FAILED_DOC_RETENTION_DAYS) * DAY,
            ),
            summary,
          ),
      ],
      [
        "pending_docs_deleted",
        () =>
          deleteDocuments(
            "pending",
            agoIso(
              now,
              ruleNumber(rules, "pending_docs_deleted", "hours", PENDING_DOC_RETENTION_HOURS) *
                HOUR,
            ),
            summary,
          ),
      ],
      [
        "notification_log_deleted",
        () =>
          deleteOlderThan(
            "notification_log",
            "created_at",
            agoIso(
              now,
              ruleNumber(
                rules,
                "notification_log_deleted",
                "days",
                NOTIFICATION_LOG_RETENTION_DAYS,
              ) * DAY,
            ),
          ),
      ],
      [
        "cron_ticks_deleted",
        () =>
          deleteOlderThan(
            "cron_ticks",
            "started_at",
            agoIso(
              now,
              ruleNumber(rules, "cron_ticks_deleted", "days", CRON_TICK_RETENTION_DAYS) * DAY,
            ),
          ),
      ],
      ["orphan_attachments_deleted", () => deleteOrphanAttachments(now, overBudget, summary)],
      ["escrow_auto_cancelled", () => autoCancelEscrow(now, overBudget, summary)],
      ["expire_pending_offers", () => expireOffersStep(now, overBudget, summary)],
      // Abandoned LINE link flows: the state is useless once expired.
      [
        "line_states_deleted",
        () => deleteOlderThan("line_link_states", "expires_at", now.toISOString()),
      ],
      // Rules added with the automation engine. Each one is skipped when an
      // admin switches it off, and reads its numbers from the rules table.
      ["checkin_missing", () => checkinMissing(now, rules)],
      ["routine_overdue_escalate", () => routineOverdueEscalate(now, rules)],
      ["insurance_expiring", () => documentsExpiring(now, rules, "insurance_expiring")],
      ["warranty_expiring", () => documentsExpiring(now, rules, "warranty_expiring")],
      ["premium_expiring", () => premiumExpiring(now, rules)],
      ["payg_overdue_suspend", () => paygOverdue(now)],
      ["funeral_review_stale", () => funeralReviewStale(now, rules)],
      ["job_no_offers", () => jobsWithoutOffers(now, rules)],
      ["budget_over_percent", () => budgetOverPercent(now, rules)],
    ];
    for (const [key, step] of steps) {
      if (overBudget()) {
        summary["stopped_early_at"] = key;
        break;
      }
      // An admin switching a rule off has to stop it running, not just hide it.
      if (!ruleEnabled(rules, key)) {
        summary[key] = -1;
        continue;
      }
      const count = await step();
      summary[key] = count;
      await recordRuleRun(key, count);
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
/**
 * Family Radar change detection.
 *
 * Deterministic on purpose: a routine is "changed" when the days since its last
 * log exceed interval_days + grace_days. Nothing is inferred and nothing is
 * diagnosed - the notification states that the pattern differs from usual and
 * suggests getting in touch, which is the wording the blueprint asks for.
 *
 * alerted_at is the idempotency guard: set when an alert goes out, cleared by
 * the next log, so one gap produces one alert rather than one every five
 * minutes.
 */
async function detectRoutineChanges(now: Date, overBudget: () => boolean): Promise<number> {
  const { data: routines, error } = await supabaseAdmin
    .from("family_routines")
    .select("id, family_id, subject_user_id, title, interval_days, grace_days")
    .eq("is_active", true)
    .is("alerted_at", null)
    .limit(200);
  if (error) throw new Error(`family_routines: ${error.message}`);
  if (!routines || routines.length === 0) return 0;

  const todayMs = Date.parse(todayInBangkok(now) + "T00:00:00Z");
  let alerted = 0;

  for (const r of routines) {
    if (overBudget()) break;

    const { data: last } = await supabaseAdmin
      .from("routine_logs")
      .select("logged_on")
      .eq("routine_id", r.id as string)
      .order("logged_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Never logged yet: nothing to compare against, so there is no pattern to
    // have changed. Waiting for a first log avoids alerting on setup.
    if (!last?.logged_on) continue;

    const gapDays = Math.floor(
      (todayMs - Date.parse((last.logged_on as string) + "T00:00:00Z")) / DAY,
    );
    const limit = (r.interval_days as number) + (r.grace_days as number);
    if (gapDays <= limit) continue;

    // Claim first: if another invocation already alerted, this update matches
    // no row and we skip, so the notification is written at most once.
    const { data: claimed } = await supabaseAdmin
      .from("family_routines")
      .update({ alerted_at: new Date(now).toISOString() })
      .eq("id", r.id as string)
      .is("alerted_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const { data: members } = await supabaseAdmin
      .from("family_members")
      .select("user_id")
      .eq("family_id", r.family_id as string);

    // Through resolveMemberLabels, not family_members.display_name: that is a
    // nickname almost nobody sets, so the alert used to read "ของสมาชิก".
    const { resolveMemberLabels } = await import("./family-labels.server");
    const labels = await resolveMemberLabels(r.family_id as string).catch(() => []);
    const subject = labels.find((m) => m.userId === r.subject_user_id)?.label || "สมาชิกครอบครัว";

    const rows = (members ?? [])
      .map((m) => m.user_id as string)
      // The person being tracked is not told their own pattern changed.
      .filter((uid) => uid !== r.subject_user_id)
      .map((uid) => ({
        user_id: uid,
        kind: "family_routine",
        title: "กิจวัตรเปลี่ยนจากปกติ",
        body: noticeBody("แนะนำให้ลองติดต่อสอบถาม", [
          ["กิจวัตร", r.title as string],
          ["ของ", subject],
          ["ไม่มีบันทึกมา", `${gapDays} วัน`],
          ["ปกติทุก", `${r.interval_days} วัน (ผ่อนผัน ${r.grace_days} วัน)`],
          ["บันทึกล่าสุด", dayTH(`${last.logged_on as string}T00:00:00+07:00`)],
        ]),
        href: "/family",
        ref_table: "family_routines",
        ref_id: r.id as string,
      }));

    if (rows.length > 0) {
      // Through notifyUsers, so a routine that has gone quiet reaches the
      // person on LINE too, not only as a dot they have to open the app to see.
      const { notifyUsers } = await import("./notify.server");
      await notifyUsers(
        rows.map((r) => r.user_id),
        {
          kind: rows[0]!.kind,
          title: rows[0]!.title,
          body: rows[0]!.body,
          href: rows[0]!.href,
          refTable: rows[0]!.ref_table,
          refId: rows[0]!.ref_id,
        },
      );
      alerted += rows.length;
    }
  }

  return alerted;
}

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

/** 1.4 escrow: held past scheduled_at+1h without customer verify → partial-refunded */
async function autoCancelEscrow(
  now: Date,
  overBudget: () => boolean,
  summary: TickSummary,
): Promise<number> {
  if (overBudget()) {
    summary["stopped_early_at"] = "escrow_auto_cancelled";
    return 0;
  }
  try {
    const { autoCancelHeldPayments } = await import("./payment.server");
    return await autoCancelHeldPayments(now);
  } catch (err) {
    console.error("[tick] escrow auto-cancel:", err instanceof Error ? err.message : err);
    summary["escrow_auto_cancel_error"] = 1;
    return 0;
  }
}

async function expireOffersStep(
  now: Date,
  overBudget: () => boolean,
  summary: TickSummary,
): Promise<number> {
  if (overBudget()) {
    summary["stopped_early_at"] = "expire_pending_offers";
    return 0;
  }
  try {
    const { expirePendingOffers } = await import("./marketplace.server");
    return await expirePendingOffers(now);
  } catch (err) {
    console.error("[tick] expire offers:", err instanceof Error ? err.message : err);
    return 0;
  }
}

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

// ---------------------------------------------------------------------------
// Rules added with the automation engine.
//
// Each one answers a question somebody asked out loud: "did mum check in this
// week", "is the insurance about to lapse", "is anyone going to look at my
// funeral plan". They all notify through notifyUsers, which means they get the
// inbox, the red dot, LINE and any webhook for free.
//
// Every one is idempotent within its window: the tick runs every five minutes,
// so a rule that notified on every run would be a way to make people turn
// notifications off. Each checks for its own recent notification first.
// ---------------------------------------------------------------------------

/** Has this exact notification already gone out for this subject recently? */
async function alreadyNotified(
  userId: string,
  kind: string,
  refId: string,
  withinMs: number,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("app_notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("ref_id", refId)
    .gte("created_at", new Date(Date.now() - withinMs).toISOString())
    .limit(1);
  return (data ?? []).length > 0;
}

/** Nobody has checked in for N days: tell the rest of the family. */
async function checkinMissing(now: Date, rules: RuleSet): Promise<number> {
  const days = ruleNumber(rules, "checkin_missing", "days", 3);
  const cutoff = new Date(now.getTime() - days * DAY).toISOString();

  const { data: members } = await supabaseAdmin
    .from("family_members")
    .select("family_id, user_id")
    .limit(2000);
  if (!members?.length) return 0;

  // Group by family so one query per family answers for all its members.
  const byFamily = new Map<string, string[]>();
  for (const m of members) {
    const fid = m.family_id as string;
    byFamily.set(fid, [...(byFamily.get(fid) ?? []), m.user_id as string]);
  }

  let sent = 0;
  for (const [familyId, userIds] of byFamily) {
    const { data: recent } = await supabaseAdmin
      .from("family_checkins")
      .select("user_id")
      .eq("family_id", familyId)
      .gte("created_at", cutoff);
    const checkedIn = new Set((recent ?? []).map((r) => r.user_id as string));

    for (const uid of userIds) {
      if (checkedIn.has(uid)) continue;
      // Notify the others, not the person who has not checked in: the point is
      // that somebody goes and asks them.
      const others = userIds.filter((u) => u !== uid);
      if (others.length === 0) continue;
      if (await alreadyNotified(others[0]!, "checkin_missing", uid, days * DAY)) continue;

      const { userLabel } = await import("./family-labels.server");
      const who = (await userLabel(uid)) || "สมาชิกครอบครัว";
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", uid)
        .maybeSingle();
      const { data: lastCheckin } = await supabaseAdmin
        .from("family_checkins")
        .select("created_at, status")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sent += await notifyUsers(
        others,
        {
          kind: "checkin_missing",
          title: "ยังไม่มีเช็คอิน",
          body: noticeBody("ลองติดต่อสอบถามดูว่าทุกอย่างเรียบร้อยไหม", [
            ["สมาชิก", who],
            ["ไม่ได้เช็คอินมา", `${days} วัน`],
            ["เช็คอินล่าสุด", whenTH((lastCheckin?.created_at as string | null) ?? null)],
          ]),
          href: "/family",
          refTable: "family_checkins",
          refId: uid,
          params: { name: prof?.display_name ?? "", days },
        },
        null,
      );
    }
  }
  return sent;
}

/**
 * A routine overdue by a multiple of its own interval.
 *
 * The existing routine alert waits for interval + grace, which is right for
 * "they forgot to log it". This is the other case: a week of nothing on a daily
 * routine, where waiting for the grace period to elapse again is too slow.
 */
async function routineOverdueEscalate(now: Date, rules: RuleSet): Promise<number> {
  const multiplier = ruleNumber(rules, "routine_overdue_escalate", "multiplier", 2);

  const { data: routines } = await supabaseAdmin
    .from("family_routines")
    .select("id, family_id, subject_user_id, title, interval_days")
    .eq("is_active", true)
    .limit(500);
  if (!routines?.length) return 0;

  let sent = 0;
  for (const r of routines) {
    const limitDays = Number(r.interval_days) * multiplier;
    const { data: last } = await supabaseAdmin
      .from("routine_logs")
      .select("logged_on")
      .eq("routine_id", r.id as string)
      .order("logged_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last?.logged_on) continue;

    const daysSince = Math.floor(
      (now.getTime() - new Date(`${last.logged_on}T00:00:00Z`).getTime()) / DAY,
    );
    if (daysSince < limitDays) continue;

    const { data: members } = await supabaseAdmin
      .from("family_members")
      .select("user_id")
      .eq("family_id", r.family_id as string);
    const ids = (members ?? []).map((m) => m.user_id as string);
    if (ids.length === 0) continue;
    if (await alreadyNotified(ids[0]!, "routine_overdue", r.id as string, limitDays * DAY))
      continue;

    const { resolveMemberLabels } = await import("./family-labels.server");
    const overdueLabels = await resolveMemberLabels(r.family_id as string).catch(() => []);
    const subjectName =
      overdueLabels.find((m) => m.userId === r.subject_user_id)?.label || "สมาชิกครอบครัว";

    sent += await notifyUsers(
      ids,
      {
        kind: "routine_overdue",
        title: "กิจวัตรค้างนานผิดปกติ",
        body: noticeBody("ลองติดต่อสอบถามหรือช่วยกันเตือน", [
          ["กิจวัตร", r.title as string],
          ["ของ", subjectName],
          ["ไม่มีบันทึกมา", `${daysSince} วัน`],
          ["ปกติทุก", `${r.interval_days} วัน`],
        ]),
        href: "/family",
        refTable: "family_routines",
        refId: r.id as string,
        params: { title: r.title as string, days: daysSince },
      },
      null,
    );
  }
  return sent;
}

/**
 * Documents with an expiry date coming up.
 *
 * Insurance uses due_date and a warranty uses warranty_until, but the shape of
 * the rule is identical, so one function serves both keys rather than two that
 * drift apart.
 */
async function documentsExpiring(
  now: Date,
  rules: RuleSet,
  key: "insurance_expiring" | "warranty_expiring",
): Promise<number> {
  const days = ruleNumber(rules, key, "days", 30);
  const column = key === "insurance_expiring" ? "due_date" : "warranty_until";
  const until = new Date(now.getTime() + days * DAY).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const { data: docs } = await supabaseAdmin
    .from("documents")
    .select(`id, user_id, title, ${column}`)
    .gte(column, today)
    .lte(column, until)
    .limit(200);
  if (!docs?.length) return 0;

  let sent = 0;
  for (const d of docs as Array<Record<string, unknown>>) {
    const userId = d["user_id"] as string;
    const id = d["id"] as string;
    if (await alreadyNotified(userId, key, id, days * DAY)) continue;

    const on = String(d[column] ?? "");
    sent += await notifyUsers(
      [userId],
      {
        kind: key,
        title: key === "insurance_expiring" ? "เอกสารใกล้หมดอายุ" : "ประกันสินค้าใกล้หมด",
        body: noticeBody(String(d["title"] ?? ""), [
          [key === "insurance_expiring" ? "หมดอายุ" : "ประกันหมด", dayTH(`${on}T00:00:00+07:00`)],
          [
            "เหลืออีก",
            `${Math.max(0, Math.ceil((Date.parse(`${on}T00:00:00+07:00`) - now.getTime()) / DAY))} วัน`,
          ],
          ...(key === "insurance_expiring"
            ? ([["ระบบทำให้", "สร้างงาน “ต่ออายุ” ไว้ในเรื่องที่ต้องทำแล้ว"]] as Array<
                [string, string]
              >)
            : []),
        ]),
        href: "/docs",
        refTable: "documents",
        refId: id,
        params: { title: String(d["title"] ?? ""), on },
      },
      null,
    );

    // Insurance gets a task as well: a notification is read and forgotten,
    // and renewing is an errand somebody has to actually run.
    if (key === "insurance_expiring") {
      const { data: existing } = await supabaseAdmin
        .from("reminders")
        .select("id")
        .eq("user_id", userId)
        .eq("source_document_id", id)
        .limit(1);
      if ((existing ?? []).length === 0) {
        await supabaseAdmin.from("reminders").insert({
          user_id: userId,
          title: `ต่ออายุ: ${d["title"] ?? ""}`,
          due_at: new Date(`${on}T09:00:00+07:00`).toISOString(),
          source_document_id: id,
        });
      }
    }
  }
  return sent;
}

/** A paid plan about to lapse. Nothing warned about this before: it just stopped. */
async function premiumExpiring(now: Date, rules: RuleSet): Promise<number> {
  const days = ruleNumber(rules, "premium_expiring", "days", 7);
  const until = new Date(now.getTime() + days * DAY).toISOString();

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, plan_tier, plan_expires_at")
    .in("plan_tier", ["premium", "family"])
    .gte("plan_expires_at", now.toISOString())
    .lte("plan_expires_at", until)
    .limit(500);
  if (!profiles?.length) return 0;

  let sent = 0;
  for (const p of profiles) {
    const id = p.id as string;
    if (await alreadyNotified(id, "plan_expiring", id, days * DAY)) continue;
    const on = String(p.plan_expires_at ?? "").slice(0, 10);
    sent += await notifyUsers(
      [id],
      {
        kind: "plan_expiring",
        title: "แพ็กของคุณใกล้หมดอายุ",
        body: noticeBody("ต่ออายุได้จากหน้าสนับสนุนและแพ็กเกจ", [
          ["แพ็ก", p.plan_tier === "family" ? "Family" : "Premium"],
          ["หมดอายุ", dayTH(String(p.plan_expires_at ?? "")) || on],
          [
            "เหลืออีก",
            `${Math.max(0, Math.ceil((Date.parse(String(p.plan_expires_at ?? "")) - now.getTime()) / DAY))} วัน`,
          ],
        ]),
        href: "/support",
        refTable: "profiles",
        refId: id,
        params: { planTier: String(p.plan_tier), on },
      },
      null,
    );
  }
  return sent;
}

/**
 * PAYG left unpaid past the grace period.
 *
 * The pricing text has always promised this - "ชำระภายใน grace days มิฉะนั้น
 * ระบบจะระงับ AI" - and nothing enforced it. Suspension is a flag on the
 * profile that the quota check reads, not a deletion of anything.
 */
async function paygOverdue(now: Date): Promise<number> {
  const { data: settings } = await supabaseAdmin
    .from("platform_settings")
    .select("payg_grace_days")
    .maybeSingle();
  const grace = Number((settings as { payg_grace_days?: number } | null)?.payg_grace_days ?? 7);
  const cutoff = new Date(now.getTime() - grace * DAY).toISOString();

  const { data: unpaid } = await supabaseAdmin
    .from("premium_payments")
    .select("id, user_id, created_at, amount, period")
    .eq("plan_tier", "payg")
    .eq("payment_status", "pending")
    .lte("created_at", cutoff)
    .limit(200);
  if (!unpaid?.length) return 0;

  let sent = 0;
  for (const row of unpaid) {
    const uid = row.user_id as string | null;
    if (!uid) continue;
    if (await alreadyNotified(uid, "payg_overdue", row.id as string, grace * DAY)) continue;
    await supabaseAdmin.from("profiles").update({ ai_suspended: true }).eq("id", uid);
    sent += await notifyUsers(
      [uid],
      {
        kind: "payg_overdue",
        title: "ค้างชำระ PAYG — ระงับการใช้ AI ชั่วคราว",
        body: noticeBody("ชำระแล้วระบบจะเปิดให้ใช้อีกครั้งอัตโนมัติ", [
          ["ยอดค้าง", bahtTH(row.amount as number | null)],
          ["รอบบิล", (row.period as string | null) ?? ""],
          ["แจ้งยอดเมื่อ", dayTH((row.created_at as string | null) ?? null)],
          ["เกินกำหนดมา", `${grace} วัน`],
        ]),
        href: "/support",
        refTable: "premium_payments",
        refId: row.id as string,
        params: { graceDays: grace },
      },
      null,
    );
  }
  return sent;
}

/** A funeral plan nobody has looked at. The first notification can be missed. */
async function funeralReviewStale(now: Date, rules: RuleSet): Promise<number> {
  const hours = ruleNumber(rules, "funeral_review_stale", "hours", 48);
  const cutoff = new Date(now.getTime() - hours * HOUR).toISOString();

  const { data: plans } = await supabaseAdmin
    .from("funeral_plans")
    .select("id, user_id, selected_package, updated_at, created_at")
    .eq("admin_status", "reviewing")
    .lte("updated_at", cutoff)
    .limit(50);
  if (!plans?.length) return 0;

  const { data: admins } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  const adminIds = (admins ?? []).map((a) => a.user_id as string);
  if (adminIds.length === 0) return 0;

  let sent = 0;
  for (const plan of plans) {
    if (await alreadyNotified(adminIds[0]!, "funeral_stale", plan.id as string, hours * HOUR)) {
      continue;
    }
    sent += await notifyUsers(
      adminIds,
      {
        kind: "funeral_stale",
        title: "แผนงานศพรอยืนยันนานแล้ว",
        body: noticeBody("ยังไม่มีใครตรวจแผนนี้", [
          ["ผู้ใช้", await userLabelSafe(plan.user_id as string | null)],
          ["แพ็กเกจ", (plan.selected_package as string | null) ?? ""],
          ["รอมาแล้ว", `มากกว่า ${hours} ชั่วโมง`],
          ["ส่งเข้ามาเมื่อ", whenTH((plan.created_at as string | null) ?? null)],
        ]),
        href: "/admin/funeral",
        refTable: "funeral_plans",
        refId: plan.id as string,
        params: { hours },
      },
      null,
    );
  }
  return sent;
}

/** A job that has been up a while with nobody quoting. Tell the helpers who fit. */
async function jobsWithoutOffers(now: Date, rules: RuleSet): Promise<number> {
  const hours = ruleNumber(rules, "job_no_offers", "hours", 24);
  const minScore = ruleNumber(rules, "job_no_offers", "minScore", 70);
  const cutoff = new Date(now.getTime() - hours * HOUR).toISOString();

  const { data: jobs } = await supabaseAdmin
    .from("jobs")
    .select("id, title, status, created_at, location_text, budget_min, budget_max, scheduled_at")
    .eq("status", "open")
    .lte("created_at", cutoff)
    .limit(30);
  if (!jobs?.length) return 0;

  const { matchHelpersForJob } = await import("./marketplace.server");
  let sent = 0;
  for (const job of jobs) {
    const { count } = await supabaseAdmin
      .from("job_offers")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id as string);
    if ((count ?? 0) > 0) continue;

    const matches = await matchHelpersForJob(supabaseAdmin, job.id as string);
    const good = matches.filter((m) => m.score >= minScore);
    if (good.length === 0) continue;

    const { data: helpers } = await supabaseAdmin
      .from("helper_profiles")
      .select("id, user_id")
      .in(
        "id",
        good.map((m) => m.helperId),
      );
    const ids = (helpers ?? []).map((h) => h.user_id as string);
    if (ids.length === 0) continue;
    if (await alreadyNotified(ids[0]!, "job_match", job.id as string, hours * HOUR)) continue;

    sent += await notifyUsers(
      ids,
      {
        kind: "job_match",
        title: "มีงานที่ตรงกับคุณ",
        body: noticeBody((job.title as string) ?? "", [
          ["พื้นที่", (job.location_text as string | null) ?? ""],
          [
            "งบที่ตั้งไว้",
            budgetText(job.budget_min as number | null, job.budget_max as number | null),
          ],
          ["นัดหมาย", whenTH((job.scheduled_at as string | null) ?? null)],
          ["ประกาศเมื่อ", whenTH((job.created_at as string | null) ?? null)],
        ]),
        href: "/helper-dashboard",
        refTable: "jobs",
        refId: job.id as string,
        params: { jobTitle: (job.title as string) ?? "" },
      },
      null,
    );
  }
  return sent;
}

/** Spending against the ceiling the user set for themselves. */
async function budgetOverPercent(now: Date, rules: RuleSet): Promise<number> {
  const percent = ruleNumber(rules, "budget_over_percent", "percent", 80);

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, monthly_budget")
    .not("monthly_budget", "is", null)
    .limit(1000);
  if (!profiles?.length) return 0;

  // Bangkok month, not UTC: a warning on the 1st at 05:00 local would be about
  // last month.
  const bkk = new Date(now.getTime() + 7 * HOUR);
  const monthStart = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}-01`;

  let sent = 0;
  for (const p of profiles) {
    const budget = Number(p.monthly_budget);
    if (!Number.isFinite(budget) || budget <= 0) continue;

    const { data: rows } = await supabaseAdmin
      .from("expenses")
      .select("amount")
      .eq("user_id", p.id as string)
      .gte("spent_on", monthStart);
    const spent = (rows ?? []).reduce((n, r) => n + Number(r.amount ?? 0), 0);
    if (spent < (budget * percent) / 100) continue;

    // Once per month per user: the number only goes up, and a daily reminder
    // that you are over budget helps nobody.
    if (await alreadyNotified(p.id as string, "budget_warning", p.id as string, 28 * DAY)) continue;

    sent += await notifyUsers(
      [p.id as string],
      {
        kind: "budget_warning",
        title: "ใช้จ่ายเกินงบที่ตั้งไว้",
        body: noticeBody("ดูรายการทั้งหมดได้ในหน้ารายรับ-รายจ่าย", [
          ["ใช้ไปเดือนนี้", bahtTH(spent)],
          ["งบที่ตั้งไว้", bahtTH(budget)],
          ["คิดเป็น", `${Math.round((spent / budget) * 100)}% ของงบ`],
          ["เกณฑ์เตือน", `${percent}%`],
          ["เหลืออีก", spent < budget ? bahtTH(budget - spent) : "ใช้เกินงบแล้ว"],
        ]),
        href: "/money",
        refTable: "profiles",
        refId: p.id as string,
        params: { spent: Math.round(spent), budget: Math.round(budget) },
      },
      null,
    );
  }
  return sent;
}
