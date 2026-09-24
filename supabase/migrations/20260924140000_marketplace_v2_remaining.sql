-- Phase 2 remaining: counter-offer chain, booking fields, offer expiry support

-- Counter-offer: link to parent offer + round number
ALTER TABLE public.job_offers
  ADD COLUMN IF NOT EXISTS parent_offer_id uuid REFERENCES public.job_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 1 CHECK (round >= 1 AND round <= 20);

CREATE INDEX IF NOT EXISTS job_offers_parent_idx ON public.job_offers (parent_offer_id);
CREATE INDEX IF NOT EXISTS job_offers_expires_idx ON public.job_offers (status, expires_at)
  WHERE status = 'pending' AND expires_at IS NOT NULL;

-- Default expiry 48h when not set (app can also set explicitly)
-- Booking fields on jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS booked_at timestamptz,
  ADD COLUMN IF NOT EXISTS booking_notes text,
  ADD COLUMN IF NOT EXISTS no_show boolean NOT NULL DEFAULT false;

-- Emergency flags on safety_reports
ALTER TABLE public.safety_reports
  ADD COLUMN IF NOT EXISTS is_emergency boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS safety_reports_emergency_idx
  ON public.safety_reports (is_emergency, status, created_at DESC)
  WHERE is_emergency = true;
