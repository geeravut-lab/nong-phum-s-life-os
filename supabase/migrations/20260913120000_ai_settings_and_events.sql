-- Phase 1.1: let an admin pick the AI provider and models without a redeploy.
--
-- ai_settings holds *which* provider/model to use. API keys never live here;
-- they stay in the environment, and the app refuses to select a provider whose
-- key is missing. NULL in a provider column means "not set here, fall through
-- to the environment"; 'none' in fallback_provider means fallback is off.
CREATE TABLE public.ai_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_provider text CHECK (default_provider IN ('anthropic', 'openai', 'google')),
  fallback_provider text CHECK (fallback_provider IN ('anthropic', 'openai', 'google', 'none')),
  -- {"google": {"chat": "...", "document": "...", "reasoning": "..."}, ...}
  -- Any provider/task key that is absent falls back to the default in code.
  model_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- Same shape as platform_settings, with one difference: UPDATE is granted too.
-- platform_settings only grants SELECT, which makes its admin-write policy
-- unreachable from a client; that is left for phase 1.4 to sort out.
GRANT SELECT, UPDATE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_settings_read ON public.ai_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY ai_settings_admin_write ON public.ai_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_ai_settings_updated
  BEFORE UPDATE ON public.ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The single row exists from the start so the app can always UPDATE it.
INSERT INTO public.ai_settings (id) VALUES (true);

-- ai_events records provider fallbacks and errors so an admin can see when a
-- quota ran out and on which provider. Successful calls are not logged; that
-- would swell the table for nothing. Written only by the server.
CREATE TABLE public.ai_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  task text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'fallback', 'error')),
  error_code text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_events_created_at_idx ON public.ai_events (created_at DESC);

GRANT SELECT ON public.ai_events TO authenticated;
GRANT ALL ON public.ai_events TO service_role;
ALTER TABLE public.ai_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_events_admin_read ON public.ai_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
-- No write policy on purpose: only the service role inserts.
