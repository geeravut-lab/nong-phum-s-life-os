-- Soft-remove demo seed places/deals; mark remaining; family max; premium admin flow

ALTER TABLE public.local_places
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS google_place_id text;

-- Deactivate known demo seed names
UPDATE public.local_places
SET is_active = false, is_demo = true, source = 'seed'
WHERE name IN (
  'สวนหลวง ร.9',
  'ตลาดนัดรถไฟศรีนครินทร์',
  'เมกาบางนา',
  'คาเฟ่ริมน้ำบางกะเจ้า',
  'เวิร์คช็อปศิลปะเด็ก บางนา'
);

UPDATE public.local_deals d
SET is_active = false
FROM public.local_places p
WHERE d.place_id = p.id AND p.is_demo = true;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS family_max_members int NOT NULL DEFAULT 5;

-- Premium payments already exist; ensure admin can list all
