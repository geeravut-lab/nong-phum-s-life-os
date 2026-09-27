-- What an AI call actually costs, and making the Family plan mean something.
--
-- 1) Nothing in this codebase recorded tokens, so every number in the pricing
--    review is an estimate from the size of the prompts in the source. One row
--    per day per task per model, with the calls and the tokens, turns that into
--    measurement. Deliberately not per user: threading a user id through twelve
--    call sites buys little, because "calls per user" is already in
--    ai_usage_monthly and "cost per call" is what was missing - multiply the
--    two and the per-user question is answered without putting another copy of
--    who-did-what in the database.
--
-- 2) Premium was never counted at all (the quota check returns before touching
--    the counters), so there was no usage data for exactly the people who pay.
--    Counting everyone and enforcing only on free plans fixes that without
--    changing what anyone is allowed to do.
--
-- 3) premium_monthly_cap is a fair-use limit for paid plans. It defaults to 0,
--    meaning unlimited, so nothing changes until an admin sets a number - the
--    point is that the lever exists before it is needed, not that it is pulled.
--
-- 4) Family granted the plan to whoever paid and to nobody else, because
--    is_premium reads one profile row. A member of a family whose owner holds
--    an unexpired family plan is now premium too, up to family_max_members
--    seats, ordered by when they joined so the entitlement cannot silently
--    change hands.

CREATE TABLE IF NOT EXISTS public.ai_token_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  task text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, task, provider, model)
);

CREATE INDEX IF NOT EXISTS ai_token_usage_day_idx ON public.ai_token_usage (day);

ALTER TABLE public.ai_token_usage ENABLE ROW LEVEL SECURITY;
-- Admins read it through a server function on the service role; nobody else
-- has any business seeing the platform's cost base.
GRANT ALL ON public.ai_token_usage TO service_role;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS premium_monthly_cap integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.platform_settings.premium_monthly_cap IS
  'Fair-use ceiling on AI calls per month for paid plans. 0 = unlimited.';
