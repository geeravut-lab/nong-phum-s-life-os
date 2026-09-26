-- Family Radar: routine tracking + deterministic change detection
--
-- The blueprint's Family Radar rests on two features the app did not have:
-- Routine Tracking (record a habit the family chose to follow) and Change
-- Detection ("mother's activity has changed from her usual pattern"). Only
-- manual Care Check-in existed, which requires the person to act.
--
-- Deliberately deterministic: the product principle is that the system never
-- diagnoses. A gap is computed from dates only - expected cadence plus a grace
-- window - and the alert says the pattern changed and suggests getting in
-- touch. No AI, no inference about health.

CREATE TABLE IF NOT EXISTS public.family_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  -- Whose routine this is. Kept as a plain uuid to match every other table
  -- here (no FK to auth.users exists anywhere yet - see PHASE-0-MIGRATION
  -- section 6, which tracks adding them across the schema).
  subject_user_id uuid NOT NULL,
  created_by uuid NOT NULL,
  title text NOT NULL,
  note text NOT NULL DEFAULT '',
  -- How often it is expected, in days: 1 = daily, 7 = weekly.
  interval_days integer NOT NULL DEFAULT 1 CHECK (interval_days BETWEEN 1 AND 90),
  -- Extra days before a miss counts as a change, so ordinary life does not
  -- trigger an alert. The spec's example is a 3-day gap.
  grace_days integer NOT NULL DEFAULT 2 CHECK (grace_days BETWEEN 0 AND 30),
  is_active boolean NOT NULL DEFAULT true,
  -- Set when an alert fires; cleared by the next log. Stops the tick from
  -- re-alerting every five minutes for the same gap.
  alerted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_routines_family_idx
  ON public.family_routines (family_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS family_routines_subject_idx
  ON public.family_routines (subject_user_id);

CREATE TABLE IF NOT EXISTS public.routine_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id uuid NOT NULL REFERENCES public.family_routines(id) ON DELETE CASCADE,
  -- Who recorded it: the subject themselves, or a family member on their behalf.
  logged_by uuid NOT NULL,
  logged_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Bangkok')::date,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One entry per routine per day; logging twice is a no-op, not a double count.
  UNIQUE (routine_id, logged_on)
);

CREATE INDEX IF NOT EXISTS routine_logs_routine_idx
  ON public.routine_logs (routine_id, logged_on DESC);

ALTER TABLE public.family_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_logs ENABLE ROW LEVEL SECURITY;

-- Any member of the family may read and log; this is shared care data by
-- design, and membership is what the rest of the family tables gate on.
CREATE POLICY family_routines_member_read ON public.family_routines
  FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));

CREATE POLICY family_routines_member_write ON public.family_routines
  FOR ALL TO authenticated
  USING (public.is_family_member(family_id, auth.uid()))
  WITH CHECK (public.is_family_member(family_id, auth.uid()));

CREATE POLICY routine_logs_member_read ON public.routine_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.family_routines r
      WHERE r.id = routine_logs.routine_id
        AND public.is_family_member(r.family_id, auth.uid())
    )
  );

CREATE POLICY routine_logs_member_write ON public.routine_logs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.family_routines r
      WHERE r.id = routine_logs.routine_id
        AND public.is_family_member(r.family_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.family_routines r
      WHERE r.id = routine_logs.routine_id
        AND public.is_family_member(r.family_id, auth.uid())
    )
  );
