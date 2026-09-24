-- Verifier invites + public plan code (no UUID for relatives)

ALTER TABLE public.legacy_contacts
  ADD COLUMN IF NOT EXISTS linked_user_id uuid,
  ADD COLUMN IF NOT EXISTS invite_token text,
  ADD COLUMN IF NOT EXISTS invite_status text NOT NULL DEFAULT 'none'
    CHECK (invite_status IN ('none','pending','accepted','revoked'));

CREATE UNIQUE INDEX IF NOT EXISTS legacy_contacts_invite_token_uidx
  ON public.legacy_contacts (invite_token)
  WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS legacy_contacts_linked_user_idx
  ON public.legacy_contacts (linked_user_id)
  WHERE linked_user_id IS NOT NULL;

-- Short public code per user (plan owner)
ALTER TABLE public.legacy_profiles
  ADD COLUMN IF NOT EXISTS plan_code text,
  ADD COLUMN IF NOT EXISTS display_label text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS legacy_profiles_plan_code_uidx
  ON public.legacy_profiles (plan_code)
  WHERE plan_code IS NOT NULL;

-- Allow linked verifier to read their contact row (accept flow already uses service role via server fn)
-- Linked users can SELECT contacts where they are linked_user_id
DROP POLICY IF EXISTS legacy_contacts_linked_read ON public.legacy_contacts;
CREATE POLICY legacy_contacts_linked_read ON public.legacy_contacts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR linked_user_id = auth.uid());

-- Death cases: linked verifiers can read cases for their subject
DROP POLICY IF EXISTS death_cases_verifier_select ON public.death_cases;
CREATE POLICY death_cases_verifier_select ON public.death_cases
  FOR SELECT TO authenticated
  USING (
    subject_user_id = auth.uid()
    OR reported_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.legacy_contacts c
      WHERE c.user_id = death_cases.subject_user_id
        AND c.is_verifier = true
        AND c.linked_user_id = auth.uid()
        AND c.invite_status = 'accepted'
    )
  );
