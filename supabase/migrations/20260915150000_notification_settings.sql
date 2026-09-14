-- Phase 1.3 step 4b: the switchboard for LINE delivery.
--
-- One row, same shape and policies as ai_settings: every signed-in user may
-- read it (the tick reads it through the service role anyway), only an admin
-- may update it, and the server can halt delivery by writing the halt columns.
--
-- Why a cap the admin can move: the OA has 300 push messages a month. Without
-- a guard, the day the quota runs out every notification goes quiet at once
-- and the first sign is a user complaining. The cap is what the tick compares
-- the month's usage against; digests stop first, immediates keep going until
-- the cap itself, so the reserve is what "urgent" can still spend after the
-- daily summaries have been cut.
CREATE TABLE public.notification_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Messages per calendar month the tick may send in total. Set to the OA
  -- plan's limit (300 on the free plan, verified from LINE's pricing page).
  line_monthly_cap integer NOT NULL DEFAULT 300 CHECK (line_monthly_cap >= 0),
  -- Kept back for immediate (priority = 'high') messages: digests stop
  -- sending once usage reaches cap - reserve.
  line_digest_reserve integer NOT NULL DEFAULT 50 CHECK (line_digest_reserve >= 0),
  -- Bangkok hour at which the daily digest goes out.
  line_digest_hour smallint NOT NULL DEFAULT 8 CHECK (line_digest_hour BETWEEN 0 AND 23),
  -- Set by the tick when LINE rejects the channel access token (401/403):
  -- nothing is sent until this passes or an admin clears it. An ai_events
  -- row is written at the same time so the admin console shows why.
  line_halted_until timestamptz,
  line_halt_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, UPDATE ON public.notification_settings TO authenticated;
GRANT ALL ON public.notification_settings TO service_role;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_settings_read ON public.notification_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY notification_settings_admin_write ON public.notification_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_notification_settings_updated
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The single row exists from the start so the app can always UPDATE it.
INSERT INTO public.notification_settings (id) VALUES (true);
