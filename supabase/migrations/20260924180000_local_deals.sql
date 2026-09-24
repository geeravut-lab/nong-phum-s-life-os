-- Phase 4: ของดีใกล้บ้าน (Local Deals / Local Intelligence)
-- Uses lat/lng + Haversine (no PostGIS required on managed Supabase)

CREATE TABLE IF NOT EXISTS public.local_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid,
  name text NOT NULL,
  name_en text,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN (
      'food','cafe','park','market','event','workshop','family','health','shop','service','other'
    )),
  description text NOT NULL DEFAULT '',
  area text,
  address text,
  lat double precision,
  lng double precision,
  tags text[] NOT NULL DEFAULT '{}',
  price_level smallint CHECK (price_level IS NULL OR (price_level BETWEEN 1 AND 4)),
  open_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  phone text,
  website text,
  is_active boolean NOT NULL DEFAULT true,
  is_verified boolean NOT NULL DEFAULT false,
  rating numeric NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_places_active_idx ON public.local_places (is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS local_places_category_idx ON public.local_places (category);
CREATE INDEX IF NOT EXISTS local_places_owner_idx ON public.local_places (owner_user_id);
CREATE INDEX IF NOT EXISTS local_places_geo_idx ON public.local_places (lat, lng) WHERE lat IS NOT NULL;

GRANT SELECT ON public.local_places TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.local_places TO authenticated;
GRANT ALL ON public.local_places TO service_role;
ALTER TABLE public.local_places ENABLE ROW LEVEL SECURITY;

CREATE POLICY local_places_read ON public.local_places
  FOR SELECT TO authenticated USING (is_active OR owner_user_id = auth.uid());
CREATE POLICY local_places_owner_write ON public.local_places
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY local_places_admin_write ON public.local_places
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_local_places_updated BEFORE UPDATE ON public.local_places
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Deals / promotions
CREATE TABLE IF NOT EXISTS public.local_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL REFERENCES public.local_places(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  discount_label text,
  budget_max numeric,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_deals_place_idx ON public.local_deals (place_id);
CREATE INDEX IF NOT EXISTS local_deals_active_ends_idx ON public.local_deals (is_active, ends_at);

GRANT SELECT ON public.local_deals TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.local_deals TO authenticated;
GRANT ALL ON public.local_deals TO service_role;
ALTER TABLE public.local_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY local_deals_read ON public.local_deals
  FOR SELECT TO authenticated
  USING (
    is_active
    OR EXISTS (
      SELECT 1 FROM public.local_places p
      WHERE p.id = local_deals.place_id AND p.owner_user_id = auth.uid()
    )
  );
CREATE POLICY local_deals_owner_write ON public.local_deals
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.local_places p
      WHERE p.id = local_deals.place_id AND p.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.local_places p
      WHERE p.id = local_deals.place_id AND p.owner_user_id = auth.uid()
    )
  );

CREATE TRIGGER trg_local_deals_updated BEFORE UPDATE ON public.local_deals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Reviews
CREATE TABLE IF NOT EXISTS public.place_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL REFERENCES public.local_places(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (place_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.place_reviews TO authenticated;
GRANT ALL ON public.place_reviews TO service_role;
ALTER TABLE public.place_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY place_reviews_read ON public.place_reviews
  FOR SELECT TO authenticated USING (true);
CREATE POLICY place_reviews_own ON public.place_reviews
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Recalc place rating
CREATE OR REPLACE FUNCTION public.recalc_place_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
BEGIN
  pid := COALESCE(NEW.place_id, OLD.place_id);
  UPDATE public.local_places p SET
    rating = COALESCE((SELECT ROUND(AVG(r.rating)::numeric, 2) FROM public.place_reviews r WHERE r.place_id = pid), 0),
    review_count = COALESCE((SELECT COUNT(*) FROM public.place_reviews r WHERE r.place_id = pid), 0)
  WHERE p.id = pid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_place_reviews_rating ON public.place_reviews;
CREATE TRIGGER trg_place_reviews_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.place_reviews
  FOR EACH ROW EXECUTE FUNCTION public.recalc_place_rating();

-- Seed sample places (Bangkok / Bang Na area — demo data)
INSERT INTO public.local_places (name, name_en, category, description, area, address, lat, lng, tags, price_level, open_hours, is_verified, rating, review_count)
VALUES
(
  'สวนหลวง ร.9', 'Suan Luang Rama IX Park', 'park',
  'สวนสาธารณะขนาดใหญ่ เหมาะพาเด็กเล่น ปั่นจักรยาน ดูน้ำพุ',
  'ประเวศ', 'ถนนเฉลิมพระเกียรติ ร.9', 13.6856, 100.6631,
  ARRAY['family','outdoor','free'], 1,
  '{"open":"05:00","close":"19:00"}'::jsonb, true, 4.6, 12
),
(
  'ตลาดนัดรถไฟศรีนครินทร์', 'Srinakarin Train Night Market', 'market',
  'ตลาดนัดอาหารและของใช้ เปิดเย็น-ดึก งบเริ่มต้นหลักร้อย',
  'ศรีนครินทร์', 'ซอยลาซาล', 13.6595, 100.6458,
  ARRAY['food','night','family'], 2,
  '{"open":"16:00","close":"23:00"}'::jsonb, true, 4.3, 28
),
(
  'เมกาบางนา', 'Mega Bangna', 'shop',
  'ห้างใหญ่ โซนเด็ก โรงหนัง ร้านอาหารครบ',
  'บางนา', 'บางนา-ตราด กม.8', 13.6467, 100.6802,
  ARRAY['family','mall','ac'], 2,
  '{"open":"10:00","close":"22:00"}'::jsonb, true, 4.4, 40
),
(
  'คาเฟ่ริมน้ำบางกะเจ้า', 'Bang Krachao Riverside Cafe', 'cafe',
  'คาเฟ่ชิ้นเล็ก ๆ บรรยากาศร่มรื่น เหมาะนั่งชิล',
  'บางกะเจ้า', 'พระประแดง', 13.6820, 100.5610,
  ARRAY['cafe','photo','weekend'], 2,
  '{"open":"09:00","close":"18:00"}'::jsonb, false, 4.1, 8
),
(
  'เวิร์คช็อปศิลปะเด็ก บางนา', 'Kids Art Workshop Bangna', 'workshop',
  'คลาสศิลปะสั้น ๆ สำหรับเด็ก งบประมาณหลักร้อยถึงพัน',
  'บางนา', 'ใกล้เมกาบางนา', 13.6501, 100.6780,
  ARRAY['kids','workshop','indoor'], 3,
  '{"open":"10:00","close":"17:00"}'::jsonb, false, 4.5, 5
)
ON CONFLICT DO NOTHING;

INSERT INTO public.local_deals (place_id, title, description, discount_label, budget_max, starts_at, ends_at)
SELECT p.id,
  'เครื่องดื่มซื้อ 1 แถม 1 วันธรรมดา',
  'เฉพาะเครื่องดื่มไม่รวมของหวาน หลัง 14:00',
  '1+1',
  150,
  now() - interval '1 day',
  now() + interval '30 days'
FROM public.local_places p WHERE p.name = 'คาเฟ่ริมน้ำบางกะเจ้า'
AND NOT EXISTS (SELECT 1 FROM public.local_deals d WHERE d.place_id = p.id)
LIMIT 1;

INSERT INTO public.local_deals (place_id, title, description, discount_label, budget_max, starts_at, ends_at)
SELECT p.id,
  'คลาสทดลองเด็ก ฟรีส่วนลด 20%',
  'จองล่วงหน้า 1 วัน งบไม่เกิน 400',
  '-20%',
  400,
  now() - interval '1 day',
  now() + interval '45 days'
FROM public.local_places p WHERE p.name = 'เวิร์คช็อปศิลปะเด็ก บางนา'
AND NOT EXISTS (SELECT 1 FROM public.local_deals d WHERE d.place_id = p.id)
LIMIT 1;
