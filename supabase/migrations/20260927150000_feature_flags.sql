-- Feature flags, so a feature can be turned off without a deploy.
--
-- Two things in this app cost money or depend on a partner being ready: the
-- Google Places lookup (billed per call) and the funeral planner (which promises
-- a human will act on what the user chooses). Both need an off switch that an
-- admin can reach at 2am, not a code change and a build.
--
-- One jsonb column rather than a table: flags are read on nearly every page, and
-- a missing key has to mean "on" so that adding a flag never silently disables
-- something already shipped.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;
