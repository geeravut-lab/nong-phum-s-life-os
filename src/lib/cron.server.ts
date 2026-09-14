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
import { supabaseAdmin } from "../integrations/supabase/client.server";
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
    const steps: Array<[string, () => Promise<number>]> = [
      ["ai_events_deleted", () => deleteOlderThan("ai_events", "created_at", agoIso(now, AI_EVENT_RETENTION_DAYS * DAY))],
      ["failed_docs_deleted", () => deleteDocuments("failed", agoIso(now, FAILED_DOC_RETENTION_DAYS * DAY), summary)],
      ["pending_docs_deleted", () => deleteDocuments("pending", agoIso(now, PENDING_DOC_RETENTION_HOURS * HOUR), summary)],
      [
        "notification_log_deleted",
        () => deleteOlderThan("notification_log", "created_at", agoIso(now, NOTIFICATION_LOG_RETENTION_DAYS * DAY)),
      ],
      ["cron_ticks_deleted", () => deleteOlderThan("cron_ticks", "started_at", agoIso(now, CRON_TICK_RETENTION_DAYS * DAY))],
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

type RetentionTable = "ai_events" | "notification_log" | "cron_ticks";

/** Plain row retention: delete everything whose timestamp column is before the cutoff. */
async function deleteOlderThan(table: RetentionTable, column: string, cutoff: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from(table).delete({ count: "exact" }).lt(column, cutoff);
  if (error) throw new Error(`${table} retention: ${error.message}`);
  return count ?? 0;
}

/**
 * Removes documents in the given status whose updated_at is before the
 * cutoff — storage object first, then the row. A row whose file cannot be
 * removed is left alone (and counted in summary.doc_errors) so the next tick
 * tries again; nothing here can create a file without a row.
 */
async function deleteDocuments(status: "failed" | "pending", cutoff: string, summary: TickSummary): Promise<number> {
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
      const { error: rmErr } = await supabaseAdmin.storage.from("documents").remove([row.storage_path]);
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
