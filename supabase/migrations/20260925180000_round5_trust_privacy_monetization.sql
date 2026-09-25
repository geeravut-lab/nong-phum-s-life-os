-- Round 5: Privacy audit, location opt-in, premium skeleton, promoted listings

CREATE TABLE IF NOT EXISTS public.privacy_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  detail text NOT NULL DEFAULT '',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS privacy_audit_log_user_idx
  ON public.privacy_audit_log (user_id, created_at DESC);

GRANT SELECT, INSERT ON public.privacy_audit_log TO authenticated;
GRANT ALL ON public.privacy_audit_log TO service_role;
ALTER TABLE public.privacy_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY privacy_audit_own_select ON public.privacy_audit_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY privacy_audit_own_insert ON public.privacy_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Profile privacy / location / plan flags
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS share_location_helpme boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'free'
    CHECK (plan_tier IN ('free', 'premium', 'family')),
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_tier text NOT NULL DEFAULT 'free'
    CHECK (plan_tier IN ('free', 'premium', 'family')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'expired', 'trialing')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_subscriptions_user_idx
  ON public.user_subscriptions (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.user_subscriptions TO authenticated;
GRANT ALL ON public.user_subscriptions TO service_role;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_subscriptions_own ON public.user_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Promoted listings
ALTER TABLE public.helper_profiles
  ADD COLUMN IF NOT EXISTS is_promoted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promoted_until timestamptz;

-- local places / merchants if table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'local_places'
  ) THEN
    ALTER TABLE public.local_places
      ADD COLUMN IF NOT EXISTS is_promoted boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS promoted_until timestamptz;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'local_merchants'
  ) THEN
    ALTER TABLE public.local_merchants
      ADD COLUMN IF NOT EXISTS is_promoted boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS promoted_until timestamptz;
  END IF;
END $$;
