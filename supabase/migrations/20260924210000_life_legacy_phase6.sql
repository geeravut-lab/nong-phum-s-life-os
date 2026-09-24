-- Phase 6 — Life Legacy (B): after-death flows
-- Death verification is DETERMINISTIC (SQL functions), never AI.

-- 1) Death case
CREATE TABLE IF NOT EXISTS public.death_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','rejected','cancelled')),
  required_confirmations smallint NOT NULL DEFAULT 2,
  confirmation_count smallint NOT NULL DEFAULT 0,
  reported_by uuid,
  report_note text NOT NULL DEFAULT '',
  confirmed_at timestamptz,
  rejected_at timestamptz,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_user_id)
);

CREATE INDEX IF NOT EXISTS death_cases_status_idx ON public.death_cases (status);

GRANT SELECT, INSERT, UPDATE ON public.death_cases TO authenticated;
GRANT ALL ON public.death_cases TO service_role;
ALTER TABLE public.death_cases ENABLE ROW LEVEL SECURITY;

-- Subject, reporters who are verifiers, or admin can read
CREATE POLICY death_cases_select ON public.death_cases
  FOR SELECT TO authenticated
  USING (
    subject_user_id = auth.uid()
    OR reported_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.legacy_contacts c
      WHERE c.user_id = death_cases.subject_user_id
        AND c.is_verifier = true
        AND (
          (c.email IS NOT NULL AND c.email = (SELECT email FROM auth.users WHERE id = auth.uid()))
          OR c.phone IS NOT NULL
        )
    )
  );

CREATE POLICY death_cases_insert ON public.death_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    reported_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY death_cases_admin_update ON public.death_cases
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR reported_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR reported_by = auth.uid());

CREATE TRIGGER trg_death_cases_updated BEFORE UPDATE ON public.death_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Confirmations (multi-person)
CREATE TABLE IF NOT EXISTS public.death_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.death_cases(id) ON DELETE CASCADE,
  confirmer_user_id uuid NOT NULL,
  confirmer_name text NOT NULL DEFAULT '',
  decision text NOT NULL CHECK (decision IN ('confirm','reject')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, confirmer_user_id)
);

GRANT SELECT, INSERT ON public.death_confirmations TO authenticated;
GRANT ALL ON public.death_confirmations TO service_role;
ALTER TABLE public.death_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY death_confirmations_select ON public.death_confirmations
  FOR SELECT TO authenticated
  USING (
    confirmer_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.death_cases d
      WHERE d.id = death_confirmations.case_id
        AND (d.subject_user_id = auth.uid() OR d.reported_by = auth.uid())
    )
  );

CREATE POLICY death_confirmations_insert ON public.death_confirmations
  FOR INSERT TO authenticated
  WITH CHECK (confirmer_user_id = auth.uid());

-- Deterministic: recount + auto-confirm when enough confirms
CREATE OR REPLACE FUNCTION public.trg_death_confirmation_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conf_count integer;
  rej_count integer;
  req integer;
BEGIN
  SELECT COUNT(*) FILTER (WHERE decision = 'confirm'),
         COUNT(*) FILTER (WHERE decision = 'reject')
    INTO conf_count, rej_count
  FROM public.death_confirmations
  WHERE case_id = NEW.case_id;

  SELECT required_confirmations INTO req
  FROM public.death_cases WHERE id = NEW.case_id;

  UPDATE public.death_cases SET
    confirmation_count = conf_count,
    status = CASE
      WHEN rej_count >= 1 AND conf_count < req THEN 'pending'
      WHEN conf_count >= req THEN 'confirmed'
      ELSE status
    END,
    confirmed_at = CASE
      WHEN conf_count >= req THEN COALESCE(confirmed_at, now())
      ELSE confirmed_at
    END
  WHERE id = NEW.case_id
    AND status IN ('pending', 'confirmed');

  -- Auto-create memorial draft when confirmed
  IF conf_count >= req THEN
    INSERT INTO public.memorials (subject_user_id, death_case_id, title, is_public, share_token)
    SELECT d.subject_user_id, d.id,
           'In memory',
           true,
           replace(gen_random_uuid()::text, '-', '')
    FROM public.death_cases d
    WHERE d.id = NEW.case_id
      AND NOT EXISTS (
        SELECT 1 FROM public.memorials m WHERE m.death_case_id = d.id
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_death_confirmation_apply ON public.death_confirmations;
CREATE TRIGGER trg_death_confirmation_apply
  AFTER INSERT ON public.death_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.trg_death_confirmation_apply();

-- 3) Memorial book
CREATE TABLE IF NOT EXISTS public.memorials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL,
  death_case_id uuid REFERENCES public.death_cases(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'In memory',
  story text NOT NULL DEFAULT '',
  cover_url text,
  is_public boolean NOT NULL DEFAULT false,
  share_token text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memorials_token_idx ON public.memorials (share_token);
GRANT SELECT, INSERT, UPDATE ON public.memorials TO authenticated;
GRANT SELECT ON public.memorials TO anon;
GRANT ALL ON public.memorials TO service_role;
ALTER TABLE public.memorials ENABLE ROW LEVEL SECURITY;

CREATE POLICY memorials_public_read ON public.memorials
  FOR SELECT TO authenticated, anon
  USING (is_public = true OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY memorials_write ON public.memorials
  FOR ALL TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_memorials_updated BEFORE UPDATE ON public.memorials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.memorial_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memorial_id uuid NOT NULL REFERENCES public.memorials(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  body text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.memorial_messages TO authenticated;
GRANT SELECT, INSERT ON public.memorial_messages TO anon;
GRANT ALL ON public.memorial_messages TO service_role;
ALTER TABLE public.memorial_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY memorial_messages_read ON public.memorial_messages
  FOR SELECT TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM public.memorials m
      WHERE m.id = memorial_messages.memorial_id AND (m.is_public OR m.created_by = auth.uid())
    )
  );
CREATE POLICY memorial_messages_insert ON public.memorial_messages
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.memorials m
      WHERE m.id = memorial_messages.memorial_id AND m.is_public = true
    )
  );

-- 4) Digital wreath
CREATE TABLE IF NOT EXISTS public.digital_wreaths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memorial_id uuid NOT NULL REFERENCES public.memorials(id) ON DELETE CASCADE,
  from_name text NOT NULL,
  message text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'none'
    CHECK (payment_status IN ('none','pending','paid','failed')),
  promptpay_id text,
  payer_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.digital_wreaths TO authenticated;
GRANT SELECT, INSERT ON public.digital_wreaths TO anon;
GRANT ALL ON public.digital_wreaths TO service_role;
ALTER TABLE public.digital_wreaths ENABLE ROW LEVEL SECURITY;

CREATE POLICY digital_wreaths_read ON public.digital_wreaths
  FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY digital_wreaths_insert ON public.digital_wreaths
  FOR INSERT TO authenticated, anon WITH CHECK (true);

-- 5) Funeral plans (AI packages)
CREATE TABLE IF NOT EXISTS public.funeral_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  death_case_id uuid REFERENCES public.death_cases(id) ON DELETE SET NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  packages jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_package text,
  total_budget numeric,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','selected','paid','in_progress','done','cancelled')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.funeral_plans TO authenticated;
GRANT ALL ON public.funeral_plans TO service_role;
ALTER TABLE public.funeral_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY funeral_plans_own ON public.funeral_plans
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_funeral_plans_updated BEFORE UPDATE ON public.funeral_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.funeral_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.funeral_plans(id) ON DELETE CASCADE,
  payer_id uuid NOT NULL,
  amount numeric NOT NULL,
  installments smallint NOT NULL DEFAULT 1
    CHECK (installments IN (1, 12, 24, 36)),
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','held','paid','failed','cancelled')),
  promptpay_id text,
  payer_ref text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.funeral_payments TO authenticated;
GRANT ALL ON public.funeral_payments TO service_role;
ALTER TABLE public.funeral_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY funeral_payments_own ON public.funeral_payments
  FOR ALL TO authenticated
  USING (payer_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (payer_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Platform setting for funeral promptpay (reuse helpme or separate)
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS funeral_promptpay_id text;
