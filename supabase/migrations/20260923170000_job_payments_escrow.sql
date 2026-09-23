-- 1.4 Payment rails (Help Me escrow) — see docs/PHASE-1.4-PAYMENT-SCHEMA.md
-- Manual PromptPay verify by admin (same pattern as donations). Gateway later.

-- Fix platform_settings GRANT so admin-write RLS can actually UPDATE from client
GRANT SELECT, UPDATE ON public.platform_settings TO authenticated;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS cancel_fee_pct numeric NOT NULL DEFAULT 20
    CHECK (cancel_fee_pct >= 0 AND cancel_fee_pct <= 100),
  ADD COLUMN IF NOT EXISTS escrow_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS helpme_promptpay_id text
    CHECK (helpme_promptpay_id IS NULL OR helpme_promptpay_id ~ '^[0-9]{10}$|^[0-9]{13}$|^[0-9]{15}$');

-- Mirror status on jobs for simple list filters
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS payment_status text
    CHECK (payment_status IS NULL OR payment_status IN (
      'pending', 'held', 'released', 'partial-refunded', 'failed'
    ));

CREATE TABLE public.job_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  payer_id uuid NOT NULL,
  helper_id uuid REFERENCES public.helper_profiles(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0 AND amount <= 1000000),
  platform_fee numeric NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  provider_amount numeric NOT NULL DEFAULT 0 CHECK (provider_amount >= 0),
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'held', 'released', 'partial-refunded', 'failed')),
  payout_status text
    CHECK (payout_status IS NULL OR payout_status IN ('pending', 'paid', 'refunded')),
  service_ended boolean NOT NULL DEFAULT false,
  cancel_fee_pct numeric NOT NULL DEFAULT 20 CHECK (cancel_fee_pct >= 0 AND cancel_fee_pct <= 100),
  promptpay_id text,
  payer_ref text CHECK (payer_ref IS NULL OR char_length(payer_ref) <= 40),
  paid_at timestamptz,
  verified_at timestamptz,
  released_at timestamptz,
  payout_paid_at timestamptz,
  confirmed_by uuid,
  payout_slip_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_payments_status_idx ON public.job_payments (payment_status, payout_status);
CREATE INDEX job_payments_payer_idx ON public.job_payments (payer_id);
CREATE INDEX job_payments_helper_idx ON public.job_payments (helper_id);

GRANT SELECT, INSERT, UPDATE ON public.job_payments TO authenticated;
GRANT ALL ON public.job_payments TO service_role;
-- no DELETE for authenticated — ledger
ALTER TABLE public.job_payments ENABLE ROW LEVEL SECURITY;

-- Job owner can read and create pending rows for their jobs
CREATE POLICY job_payments_payer_select ON public.job_payments
  FOR SELECT TO authenticated
  USING (
    payer_id = auth.uid()
    OR helper_id IN (SELECT id FROM public.helper_profiles WHERE user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY job_payments_payer_insert ON public.job_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    payer_id = auth.uid()
    AND payment_status = 'pending'
    AND paid_at IS NULL
    AND verified_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id AND j.user_id = auth.uid()
        AND j.status IN ('matched', 'in_progress')
    )
  );

-- Payer may attach ref while still pending; status transitions go through admin/server
CREATE POLICY job_payments_payer_update_ref ON public.job_payments
  FOR UPDATE TO authenticated
  USING (payer_id = auth.uid() AND payment_status = 'pending')
  WITH CHECK (payer_id = auth.uid() AND payment_status = 'pending');

CREATE POLICY job_payments_admin_all ON public.job_payments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Helper can mark service_ended only (narrow update)
CREATE POLICY job_payments_helper_service_ended ON public.job_payments
  FOR UPDATE TO authenticated
  USING (
    helper_id IN (SELECT id FROM public.helper_profiles WHERE user_id = auth.uid())
    AND payment_status IN ('held', 'released')
  )
  WITH CHECK (
    helper_id IN (SELECT id FROM public.helper_profiles WHERE user_id = auth.uid())
  );

CREATE TRIGGER trg_job_payments_updated BEFORE UPDATE ON public.job_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Keep jobs.payment_status in sync on payment row changes (best-effort; server fn also sets it)
CREATE OR REPLACE FUNCTION public.sync_job_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.jobs
  SET payment_status = NEW.payment_status, updated_at = now()
  WHERE id = NEW.job_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_job_payments_sync_status
  AFTER INSERT OR UPDATE OF payment_status ON public.job_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_job_payment_status();

-- Rating constraint (1.5): only 1–5
ALTER TABLE public.job_reviews
  DROP CONSTRAINT IF EXISTS job_reviews_rating_check;
ALTER TABLE public.job_reviews
  ADD CONSTRAINT job_reviews_rating_check CHECK (rating >= 1 AND rating <= 5);

-- After a review is inserted, recompute helper rating + jobs_done (reviewer cannot UPDATE other profiles under RLS)
CREATE OR REPLACE FUNCTION public.refresh_helper_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  avg_rating numeric;
  cnt integer;
BEGIN
  SELECT COALESCE(AVG(rating), 0), COUNT(*)
    INTO avg_rating, cnt
  FROM public.job_reviews
  WHERE helper_id = NEW.helper_id;

  UPDATE public.helper_profiles
  SET rating = ROUND(avg_rating::numeric, 1),
      jobs_done = cnt,
      updated_at = now()
  WHERE id = NEW.helper_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_reviews_refresh_rating ON public.job_reviews;
CREATE TRIGGER trg_job_reviews_refresh_rating
  AFTER INSERT OR UPDATE OF rating OR DELETE ON public.job_reviews
  FOR EACH ROW EXECUTE FUNCTION public.refresh_helper_rating();
