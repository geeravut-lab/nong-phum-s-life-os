ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS payg_grace_days int NOT NULL DEFAULT 7;

ALTER TABLE public.local_places
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maps_url text;
