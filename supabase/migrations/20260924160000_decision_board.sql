-- Phase 3: Decision Board (AI ช่วยตัดสินใจ)

CREATE TABLE IF NOT EXISTS public.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  question text NOT NULL CHECK (char_length(question) BETWEEN 3 AND 500),
  template text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'analyzed', 'decided', 'archived')),
  -- Answers to AI follow-up questions (key/value)
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Full board payload (options, criteria, matrix, pros/cons, recommendation)
  board jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text,
  chosen_option_id text,
  outcome text CHECK (outcome IS NULL OR outcome IN ('good', 'ok', 'bad', 'unknown')),
  outcome_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decisions_user_created_idx
  ON public.decisions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS decisions_user_status_idx
  ON public.decisions (user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.decisions TO authenticated;
GRANT ALL ON public.decisions TO service_role;
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY decisions_own ON public.decisions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_decisions_updated BEFORE UPDATE ON public.decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
