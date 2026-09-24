-- Marketplace v2: Quote & Offer extras, job chat + evidence, safety report/block

-- --- Offers: richer quote fields ---
ALTER TABLE public.job_offers
  ADD COLUMN IF NOT EXISTS eta_hours numeric CHECK (eta_hours IS NULL OR (eta_hours > 0 AND eta_hours <= 720)),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason text;

-- status values used by app: pending | accepted | rejected | withdrawn | expired
-- (no DB enum — text kept flexible like jobs.status)

-- --- Job-scoped chat (requester <-> assigned helper, or offer discussion) ---
CREATE TABLE IF NOT EXISTS public.job_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_messages_job_created_idx
  ON public.job_messages (job_id, created_at);

GRANT SELECT, INSERT ON public.job_messages TO authenticated;
GRANT ALL ON public.job_messages TO service_role;
ALTER TABLE public.job_messages ENABLE ROW LEVEL SECURITY;

-- Parties on the job: owner or assigned helper (by user_id via helper_profiles)
CREATE OR REPLACE FUNCTION public.is_job_party(p_job_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = p_job_id
      AND (
        j.user_id = p_uid
        OR j.assigned_helper_id IN (
          SELECT hp.id FROM public.helper_profiles hp WHERE hp.user_id = p_uid
        )
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_job_party(uuid, uuid) TO authenticated;

CREATE POLICY job_messages_party_select ON public.job_messages
  FOR SELECT TO authenticated
  USING (public.is_job_party(job_id, auth.uid()));

CREATE POLICY job_messages_party_insert ON public.job_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_job_party(job_id, auth.uid())
    AND char_length(body) BETWEEN 1 AND 4000
  );

-- --- Evidence (photos / files tied to a job) ---
CREATE TABLE IF NOT EXISTS public.job_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'evidence',
  mime_type text,
  storage_path text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_evidence_job_idx ON public.job_evidence (job_id);

GRANT SELECT, INSERT, DELETE ON public.job_evidence TO authenticated;
GRANT ALL ON public.job_evidence TO service_role;
ALTER TABLE public.job_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_evidence_party_select ON public.job_evidence
  FOR SELECT TO authenticated
  USING (public.is_job_party(job_id, auth.uid()));

CREATE POLICY job_evidence_party_insert ON public.job_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    uploader_id = auth.uid()
    AND public.is_job_party(job_id, auth.uid())
  );

CREATE POLICY job_evidence_uploader_delete ON public.job_evidence
  FOR DELETE TO authenticated
  USING (uploader_id = auth.uid());

-- Storage: reuse documents bucket under path job-evidence/{job_id}/{uuid}
-- (no new bucket required; RLS on table is the gate)

-- --- Block list ---
CREATE TABLE IF NOT EXISTS public.user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocker_idx ON public.user_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON public.user_blocks (blocked_id);

GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_blocks_own ON public.user_blocks
  FOR ALL TO authenticated
  USING (blocker_id = auth.uid())
  WITH CHECK (blocker_id = auth.uid());

-- --- Safety reports ---
CREATE TABLE IF NOT EXISTS public.safety_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  target_user_id uuid,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 80),
  details text CHECK (details IS NULL OR char_length(details) <= 2000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_reports_status_idx ON public.safety_reports (status, created_at DESC);

GRANT SELECT, INSERT ON public.safety_reports TO authenticated;
GRANT ALL ON public.safety_reports TO service_role;
ALTER TABLE public.safety_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY safety_reports_reporter_select ON public.safety_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY safety_reports_insert ON public.safety_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND status = 'open');

CREATE POLICY safety_reports_admin_update ON public.safety_reports
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_safety_reports_updated BEFORE UPDATE ON public.safety_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Hide blocked helpers from active marketplace reads (helpers still own their row)
CREATE OR REPLACE FUNCTION public.is_blocked_by(p_viewer uuid, p_other uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = p_viewer AND b.blocked_id = p_other)
       OR (b.blocker_id = p_other AND b.blocked_id = p_viewer)
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_blocked_by(uuid, uuid) TO authenticated;
