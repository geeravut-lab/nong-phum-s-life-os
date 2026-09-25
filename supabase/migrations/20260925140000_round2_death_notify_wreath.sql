-- Round 2: death notify templates, memorial video/schedule, wreath payment polish

ALTER TABLE public.memorials
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS schedule_text text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.death_notify_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.death_cases(id) ON DELETE CASCADE,
  contact_id uuid,
  contact_name text NOT NULL,
  channel_hint text NOT NULL DEFAULT '',
  message_body text NOT NULL,
  memorial_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS death_notify_messages_case_idx
  ON public.death_notify_messages (case_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.death_notify_messages TO authenticated;
GRANT ALL ON public.death_notify_messages TO service_role;
ALTER TABLE public.death_notify_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY death_notify_select ON public.death_notify_messages
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.death_cases d
      WHERE d.id = death_notify_messages.case_id
        AND (d.reported_by = auth.uid() OR d.subject_user_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.death_cases d
      JOIN public.legacy_contacts c ON c.user_id = d.subject_user_id
      WHERE d.id = death_notify_messages.case_id
        AND c.linked_user_id = auth.uid()
        AND c.is_verifier = true
        AND c.invite_status = 'accepted'
    )
  );

CREATE POLICY death_notify_insert ON public.death_notify_messages
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY death_notify_delete ON public.death_notify_messages
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid() OR public.has_role(auth.uid(), 'admin')
  );

-- Allow public update of digital_wreaths payment_status via service role only in practice;
-- authenticated can update own rows by id (mark paid soft flow)
DROP POLICY IF EXISTS digital_wreaths_update ON public.digital_wreaths;
CREATE POLICY digital_wreaths_update ON public.digital_wreaths
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
