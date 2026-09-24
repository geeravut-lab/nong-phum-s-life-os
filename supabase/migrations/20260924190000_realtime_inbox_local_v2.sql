-- Realtime inbox + Local v2 enhancements

-- 1) App notifications (per-user inbox)
CREATE TABLE IF NOT EXISTS public.app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'info'
    CHECK (kind IN (
      'job_message','job_offer','job_status','payment','safety','local','system','info'
    )),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  href text,
  ref_table text,
  ref_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_notifications_user_unread_idx
  ON public.app_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS app_notifications_user_created_idx
  ON public.app_notifications (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.app_notifications TO authenticated;
GRANT ALL ON public.app_notifications TO service_role;
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_notifications_own_select ON public.app_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY app_notifications_own_update ON public.app_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
-- inserts mostly from trigger (security definer) or service role
CREATE POLICY app_notifications_service_insert ON public.app_notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Helper: notify a user
CREATE OR REPLACE FUNCTION public.notify_user(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text DEFAULT '',
  p_href text DEFAULT NULL,
  p_ref_table text DEFAULT NULL,
  p_ref_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nid uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.app_notifications (user_id, kind, title, body, href, ref_table, ref_id)
  VALUES (p_user_id, p_kind, p_title, p_body, p_href, p_ref_table, p_ref_id)
  RETURNING id INTO nid;
  RETURN nid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, text, text, uuid) TO authenticated, service_role;

-- On new job message → notify the other party
CREATE OR REPLACE FUNCTION public.trg_job_message_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j record;
  target uuid;
BEGIN
  SELECT id, user_id, assigned_helper_id, title INTO j
  FROM public.jobs WHERE id = NEW.job_id;
  IF j.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id = j.user_id THEN
    -- requester wrote → notify assigned helper's user
    SELECT user_id INTO target FROM public.helper_profiles WHERE id = j.assigned_helper_id;
  ELSE
    target := j.user_id;
  END IF;

  IF target IS NOT NULL AND target <> NEW.sender_id THEN
    PERFORM public.notify_user(
      target,
      'job_message',
      'ข้อความใหม่ในงาน',
      left(NEW.body, 120),
      '/helpme',
      'job_messages',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_message_notify ON public.job_messages;
CREATE TRIGGER trg_job_message_notify
  AFTER INSERT ON public.job_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_job_message_notify();

-- On new job offer → notify job owner
CREATE OR REPLACE FUNCTION public.trg_job_offer_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  jtitle text;
BEGIN
  SELECT user_id, title INTO owner_id, jtitle FROM public.jobs WHERE id = NEW.job_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.helper_user_id THEN
    PERFORM public.notify_user(
      owner_id,
      'job_offer',
      'ข้อเสนอใหม่',
      coalesce(jtitle, 'งาน') || ' · ฿' || coalesce(NEW.price::text, '-'),
      '/helpme',
      'job_offers',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_offer_notify ON public.job_offers;
CREATE TRIGGER trg_job_offer_notify
  AFTER INSERT ON public.job_offers
  FOR EACH ROW EXECUTE FUNCTION public.trg_job_offer_notify();

-- Realtime publication (ignore errors if already added)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_offers;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- 2) Local v2: promoted + community notes
ALTER TABLE public.local_places
  ADD COLUMN IF NOT EXISTS is_promoted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS map_url text;

ALTER TABLE public.local_places
  ADD COLUMN IF NOT EXISTS community_note text;

-- Haversine distance (km) — no PostGIS required
CREATE OR REPLACE FUNCTION public.haversine_km(
  a_lat double precision,
  a_lng double precision,
  b_lat double precision,
  b_lng double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 2 * 6371 * asin(
    sqrt(
      power(sin(radians(b_lat - a_lat) / 2), 2) +
      cos(radians(a_lat)) * cos(radians(b_lat)) *
      power(sin(radians(b_lng - a_lng) / 2), 2)
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision)
  TO authenticated, service_role;

-- Nearby places RPC
CREATE OR REPLACE FUNCTION public.local_places_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision DEFAULT 15,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  name text,
  category text,
  description text,
  area text,
  lat double precision,
  lng double precision,
  tags text[],
  price_level smallint,
  open_hours jsonb,
  is_promoted boolean,
  rating numeric,
  review_count integer,
  distance_km double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    p.id, p.name, p.category, p.description, p.area, p.lat, p.lng,
    p.tags, p.price_level, p.open_hours, p.is_promoted, p.rating, p.review_count,
    public.haversine_km(p_lat, p_lng, p.lat, p.lng) AS distance_km
  FROM public.local_places p
  WHERE p.is_active
    AND p.lat IS NOT NULL AND p.lng IS NOT NULL
    AND public.haversine_km(p_lat, p_lng, p.lat, p.lng) <= p_radius_km
  ORDER BY p.is_promoted DESC, distance_km ASC
  LIMIT greatest(1, least(p_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.local_places_nearby(double precision, double precision, double precision, integer)
  TO authenticated, service_role;
