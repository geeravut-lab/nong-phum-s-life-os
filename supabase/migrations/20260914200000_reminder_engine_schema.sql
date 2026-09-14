-- Phase 1.3 step 1: schema for the scheduled tick (netlify/functions/tick.mts).
--
-- Three pieces, all additive:
--   * reminders gains the columns the reminder engine needs to claim a due
--     row exactly once and to record what happened to it
--   * notification_log keeps one row per delivery — the second line of
--     defence against double sends, the record the UI reads, and the ledger
--     the monthly LINE quota is counted from
--   * cron_ticks is the per-run lock and run log for the tick function
--
-- LINE delivery has two modes (decided 2026-09-14, the OA has 300 push
-- messages a month):
--   immediate — one push per occurrence, for reminders with priority = 'high'
--   digest    — one push per user per day summarising everything else
-- notification_log is shaped so one table holds both; see the CHECK.
--
-- Pre-flight, verified 2026-09-14 against production (PostgREST OpenAPI +
-- row scans) before writing this:
--   * reminders has exactly the 13 columns of the original CREATE TABLE plus
--     the user_id FK from 1.2 — none of the columns added below exist
--   * live values: recurrence {none:1}, status {done:1}, priority {high:1},
--     0 rows with NULL due_at — the CHECK below passes on existing data
--   * neither notification_log nor cron_ticks exists
-- supabase db push wraps the file in one transaction. Nothing here rewrites
-- or deletes rows; every statement is undone by DROP COLUMN / DROP CONSTRAINT /
-- DROP TABLE.


-- ---------------------------------------------------------------------------
-- 1. reminders: engine columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.reminders
  -- When to notify. NULL means "at due_at"; set only when the user asks for
  -- an earlier warning, so existing inserts need no change.
  ADD COLUMN notify_at timestamptz,
  -- Set by the tick when it claims the row (UPDATE ... WHERE notified_at IS
  -- NULL RETURNING), whether the occurrence went out immediately or inside a
  -- digest. Reset when a recurring reminder advances to its next occurrence.
  -- First line of defence against double sends.
  ADD COLUMN notified_at timestamptz,
  -- Delivery attempts for the current occurrence and the last error text,
  -- so the retry policy (3 attempts, ticks apart) has state to work from.
  ADD COLUMN notify_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN notify_error text,
  -- Recurring reminders never reach status = 'done'; "done" advances due_at
  -- instead and records when the last occurrence was completed.
  ADD COLUMN last_completed_at timestamptz;

-- The UI and the AI schema only ever write these three values; the engine
-- will switch on them, so make the database refuse anything else.
ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_recurrence_check
    CHECK (recurrence IN ('none', 'monthly', 'yearly'));

-- The tick's working set: open reminders not yet notified, ordered by when
-- they become due. Partial so it stays tiny however large the table grows.
CREATE INDEX reminders_due_for_notify_idx
  ON public.reminders (COALESCE(notify_at, due_at))
  WHERE status = 'open' AND notified_at IS NULL;


-- ---------------------------------------------------------------------------
-- 2. notification_log: one row per delivery (immediate or digest)
-- ---------------------------------------------------------------------------
-- This table is a ledger: the monthly LINE quota is counted from it, so a row
-- must outlive the reminder and the account it was about. Neither user_id nor
-- reminder_id is therefore a foreign key — the same choice as
-- account_deletions.user_id — and the only thing that ever removes rows is
-- the 90-day retention step of the tick. Rows hold ids, timestamps and an
-- error string, never message content, so keeping them past account deletion
-- is the same exposure as the audit row.
CREATE TABLE public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No FK (see above). RLS still matches it against auth.uid().
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('immediate', 'digest')),
  -- immediate: the reminder and the occurrence (its due_at at claim time).
  -- A recurring reminder produces one row per occurrence. No FK (see above);
  -- readers must LEFT JOIN reminders, the row stays after the reminder goes.
  reminder_id uuid,
  due_at timestamptz,
  -- digest: the Bangkok calendar day the summary covers.
  digest_date date,
  -- Every reminder the message mentioned. For immediate rows this is the
  -- single reminder; for digests it is the audit trail of what went out,
  -- which the per-reminder notified_at alone cannot reconstruct.
  reminder_ids uuid[] NOT NULL DEFAULT '{}',
  -- 'none' = user has no delivery channel; the row still exists so the UI
  -- can say "this came due and nothing could be sent". 'line' arrives with
  -- the LINE work later in 1.3.
  channel text NOT NULL CHECK (channel IN ('none', 'line')),
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  attempts smallint NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Each kind fills exactly its own identifying columns, so a row can never
  -- be half one thing and half the other.
  CONSTRAINT notification_log_kind_shape CHECK (
    (kind = 'immediate' AND reminder_id IS NOT NULL AND due_at IS NOT NULL AND digest_date IS NULL)
    OR
    (kind = 'digest' AND reminder_id IS NULL AND due_at IS NULL AND digest_date IS NOT NULL)
  )
);

-- Second line of defence against double sends, one per mode. Inserting the
-- row IS the claim: a retry (or an overlapping run) that already claimed the
-- reminder but died after sending cannot produce a second row for the same
-- occurrence, and a user can never receive two digests for one day.
CREATE UNIQUE INDEX notification_log_immediate_once
  ON public.notification_log (reminder_id, due_at)
  WHERE kind = 'immediate';
CREATE UNIQUE INDEX notification_log_digest_once
  ON public.notification_log (user_id, digest_date)
  WHERE kind = 'digest';

-- What the user sees on Today/Tasks.
CREATE INDEX notification_log_user_created_idx
  ON public.notification_log (user_id, created_at DESC);
-- The monthly LINE quota is counted from here (docs/PHASE-1-PLAN.md, 1.3);
-- this keeps that count an index-only scan of at most a few hundred rows.
CREATE INDEX notification_log_line_sent_idx
  ON public.notification_log (created_at)
  WHERE channel = 'line' AND status = 'sent';

CREATE TRIGGER notification_log_set_updated_at
  BEFORE UPDATE ON public.notification_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Users may read their own rows; only the tick writes, through the service role.
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;
CREATE POLICY notification_log_own_read ON public.notification_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 3. cron_ticks: run lock + run log for the scheduled function
-- ---------------------------------------------------------------------------
-- The tick inserts (job, tick) before doing anything. A second invocation for
-- the same minute — Netlify retry, overlap, or "Run now" from the UI — hits
-- the primary key and exits without touching data. finished_at/summary make
-- it a run log the admin console can show, and answer "did last night's
-- tick run at all?" without Netlify's UI.
CREATE TABLE public.cron_ticks (
  job text NOT NULL,
  -- Start of the minute the run belongs to, in UTC (Netlify schedules in UTC).
  tick timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- Per-step counts, e.g. {"ai_events_deleted": 12, "failed_docs_deleted": 1,
  -- "line_quota": {"value": 300, "totalUsage": 41}}
  summary jsonb,
  error text,
  PRIMARY KEY (job, tick)
);

-- Service role only: RLS on, no policies, no grant to authenticated.
ALTER TABLE public.cron_ticks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.cron_ticks TO service_role;
