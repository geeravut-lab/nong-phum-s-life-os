-- An instalment an admin has still to check.
--
-- Reporting a transfer used to write 'paid' straight away, so the money was
-- recorded as received the moment the payer said so - no slip reference, no
-- QR to pay against, and nothing for an admin to confirm. Membership payments
-- have gone through an admin since they existed; this brings the funeral
-- instalments onto the same loop.
--
-- 'review'   - the payer says they transferred, waiting on an admin
-- 'rejected' - an admin could not find the transfer; the payer tries again
--
-- The code writes 'review' and falls back to leaving the row 'due' with a
-- payer_ref when this migration has not been pushed yet, and both are read as
-- "waiting on an admin", so deploying before pushing is safe.

ALTER TABLE public.funeral_installments
  DROP CONSTRAINT IF EXISTS funeral_installments_payment_status_check;

ALTER TABLE public.funeral_installments
  ADD CONSTRAINT funeral_installments_payment_status_check
  CHECK (payment_status IN ('due', 'review', 'paid', 'rejected', 'cancelled'));

-- When the payer said they transferred, and what the admin wrote back if they
-- could not find it. Both nullable: a row that was never reported has neither.
ALTER TABLE public.funeral_installments
  ADD COLUMN IF NOT EXISTS reported_at timestamptz;
ALTER TABLE public.funeral_installments
  ADD COLUMN IF NOT EXISTS review_note text;

CREATE INDEX IF NOT EXISTS funeral_installments_review_idx
  ON public.funeral_installments (payment_status)
  WHERE payment_status = 'review';
