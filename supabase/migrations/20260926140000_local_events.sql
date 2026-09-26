-- Local events, the missing half of "ของดีใกล้บ้าน"
--
-- The blueprint's headline use case for this module is "what is there to do
-- with the kids this evening, under 500 baht?", and it answers by combining
-- restaurants, activities, parks, EVENTS, markets, workshops and community
-- events. Only places and promotions existed, so anything time-bound - a
-- market that runs this weekend, a workshop on Saturday - had nowhere to live.
--
-- Separate from local_deals: a deal is an offer attached to a place and valid
-- over a period, an event happens at a time and may have no place row at all
-- (a street market, a temple fair).

CREATE TABLE IF NOT EXISTS public.local_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Optional: an event may be hosted by a place in the directory, or stand alone.
  place_id uuid REFERENCES public.local_places(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'event',
  area text,
  address text,
  lat double precision,
  lng double precision,
  maps_url text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  -- Nulls mean "not stated" rather than free; the UI distinguishes them.
  price_min numeric,
  price_max numeric,
  -- The spec's filters are budget, age and time, so this is what the
  -- "with the kids" question needs to match on.
  kid_friendly boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_events_time_order CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT local_events_price_order CHECK (
    price_min IS NULL OR price_max IS NULL OR price_max >= price_min
  )
);

-- The common query is "active events from now on", nearest first.
CREATE INDEX IF NOT EXISTS local_events_when_idx
  ON public.local_events (starts_at) WHERE is_active;
CREATE INDEX IF NOT EXISTS local_events_place_idx ON public.local_events (place_id);
CREATE INDEX IF NOT EXISTS local_events_owner_idx ON public.local_events (owner_user_id);

ALTER TABLE public.local_events ENABLE ROW LEVEL SECURITY;

-- Same shape as local_places: everyone sees active rows, owners see and manage
-- their own, admins can moderate.
CREATE POLICY local_events_read ON public.local_events
  FOR SELECT TO authenticated
  USING (is_active OR owner_user_id = auth.uid());

CREATE POLICY local_events_owner_write ON public.local_events
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY local_events_admin_write ON public.local_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
