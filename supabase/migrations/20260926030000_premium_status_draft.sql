-- Allow draft (QR shown, not yet reported) and rejected on premium_payments
ALTER TABLE public.premium_payments
  DROP CONSTRAINT IF EXISTS premium_payments_payment_status_check;

ALTER TABLE public.premium_payments
  ADD CONSTRAINT premium_payments_payment_status_check
  CHECK (payment_status IN ('draft', 'pending', 'paid', 'expired', 'cancelled', 'rejected'));
