-- Billing: Free limits, Premium (PromptPay), usage counters, admin-tunable factors

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS billing_margin_pct numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS billing_cost_factor numeric NOT NULL DEFAULT 1.18,
  ADD COLUMN IF NOT EXISTS free_chat_limit int NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS free_document_limit int NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS free_decision_limit int NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS free_transcribe_limit int NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS free_total_ai_limit int NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS premium_price_monthly numeric NOT NULL DEFAULT 89,
  ADD COLUMN IF NOT EXISTS premium_price_yearly numeric NOT NULL DEFAULT 890,
  ADD COLUMN IF NOT EXISTS family_price_monthly numeric NOT NULL DEFAULT 149,
  ADD COLUMN IF NOT EXISTS family_price_yearly numeric NOT NULL DEFAULT 1490,
  ADD COLUMN IF NOT EXISTS payg_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payg_unit_price_satang int NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS billing_promptpay_id text;

CREATE TABLE IF NOT EXISTS public.ai_usage_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  year_month text NOT NULL,
  chat_count int NOT NULL DEFAULT 0,
  document_count int NOT NULL DEFAULT 0,
  decision_count int NOT NULL DEFAULT 0,
  transcribe_count int NOT NULL DEFAULT 0,
  total_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, year_month)
);

CREATE INDEX IF NOT EXISTS ai_usage_monthly_user_idx
  ON public.ai_usage_monthly (user_id, year_month);

GRANT SELECT, INSERT, UPDATE ON public.ai_usage_monthly TO authenticated;
GRANT ALL ON public.ai_usage_monthly TO service_role;
ALTER TABLE public.ai_usage_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_usage_own ON public.ai_usage_monthly
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.premium_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_tier text NOT NULL CHECK (plan_tier IN ('premium', 'family')),
  period text NOT NULL CHECK (period IN ('monthly', 'yearly')),
  amount numeric NOT NULL,
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'expired', 'cancelled')),
  promptpay_id text,
  payer_ref text,
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS premium_payments_user_idx
  ON public.premium_payments (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.premium_payments TO authenticated;
GRANT ALL ON public.premium_payments TO service_role;
ALTER TABLE public.premium_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY premium_payments_own ON public.premium_payments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY premium_payments_insert_own ON public.premium_payments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY premium_payments_update_own ON public.premium_payments
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Decision evidence mode
ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS evidence_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS evidence_mode boolean NOT NULL DEFAULT false;

-- Share benefits results with family
ALTER TABLE public.user_benefits
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS family_id uuid;
