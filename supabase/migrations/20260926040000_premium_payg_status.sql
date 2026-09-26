ALTER TABLE public.premium_payments
  DROP CONSTRAINT IF EXISTS premium_payments_payment_status_check;
ALTER TABLE public.premium_payments
  ADD CONSTRAINT premium_payments_payment_status_check
  CHECK (payment_status IN ('draft', 'pending', 'paid', 'expired', 'cancelled', 'rejected'));

ALTER TABLE public.premium_payments
  DROP CONSTRAINT IF EXISTS premium_payments_plan_tier_check;
ALTER TABLE public.premium_payments
  ADD CONSTRAINT premium_payments_plan_tier_check
  CHECK (plan_tier IN ('premium', 'family', 'payg'));
