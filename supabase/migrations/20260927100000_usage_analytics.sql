-- Which parts of the app people actually use.
--
-- The question is "which menu, how many times, by how many people" - not who
-- did what when. So nothing here is a raw event log: one row per user per day
-- per path, with a counter. That keeps the table small enough to aggregate in
-- SQL for years, and it is the smallest shape that still answers DAU/WAU/MAU
-- (distinct user_id over a window) and "top menus" (sum of views).
--
-- Paths are normalised by the caller: ids and tokens are replaced with :id
-- before they get here, so a page with a parameter is one row, not thousands.

CREATE TABLE IF NOT EXISTS public.usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day date NOT NULL,
  path text NOT NULL,
  views integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day, path)
);

CREATE INDEX IF NOT EXISTS usage_daily_day_idx ON public.usage_daily (day);
CREATE INDEX IF NOT EXISTS usage_daily_path_day_idx ON public.usage_daily (path, day);

ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;

-- A user may read their own history (and the export does), but writing goes
-- through bump_usage below so a client cannot set the counter to anything it
-- likes.
DROP POLICY IF EXISTS usage_daily_select_own ON public.usage_daily;
CREATE POLICY usage_daily_select_own ON public.usage_daily
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.usage_daily TO authenticated;

-- One page view. The day comes from the Bangkok clock, not the caller's, so a
-- device with a wrong timezone cannot land a view on the wrong day.
CREATE OR REPLACE FUNCTION public.bump_usage(p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  clean text;
BEGIN
  IF uid IS NULL THEN
    RETURN;
  END IF;

  -- Defence in depth: the client normalises, and so do we. A path that is not
  -- one of ours (or is suspiciously long) is not worth a row.
  clean := left(coalesce(p_path, ''), 80);
  IF clean = '' OR clean NOT LIKE '/%' THEN
    RETURN;
  END IF;

  INSERT INTO public.usage_daily (user_id, day, path, views)
  VALUES (uid, (now() AT TIME ZONE 'Asia/Bangkok')::date, clean, 1)
  ON CONFLICT (user_id, day, path)
  DO UPDATE SET views = public.usage_daily.views + 1, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.bump_usage(text) FROM public;
GRANT EXECUTE ON FUNCTION public.bump_usage(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Aggregates for the admin dashboard.
--
-- These read every user's rows, so they are service_role only: the server
-- function that calls them runs requireAdmin first. Granting them to
-- authenticated would make "who uses what" readable by anyone with a session,
-- whatever the RLS policy above says.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.usage_active_users(p_days integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(DISTINCT user_id)::integer
  FROM public.usage_daily
  WHERE day > ((now() AT TIME ZONE 'Asia/Bangkok')::date - greatest(p_days, 1));
$$;

CREATE OR REPLACE FUNCTION public.usage_top_paths(p_days integer, p_limit integer)
RETURNS TABLE (path text, views bigint, users bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.path, sum(u.views)::bigint AS views, count(DISTINCT u.user_id)::bigint AS users
  FROM public.usage_daily u
  WHERE u.day > ((now() AT TIME ZONE 'Asia/Bangkok')::date - greatest(p_days, 1))
  GROUP BY u.path
  ORDER BY views DESC
  LIMIT greatest(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.usage_daily_totals(p_days integer)
RETURNS TABLE (day date, views bigint, users bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.day, sum(u.views)::bigint AS views, count(DISTINCT u.user_id)::bigint AS users
  FROM public.usage_daily u
  WHERE u.day > ((now() AT TIME ZONE 'Asia/Bangkok')::date - greatest(p_days, 1))
  GROUP BY u.day
  ORDER BY u.day;
$$;

REVOKE ALL ON FUNCTION public.usage_active_users(integer) FROM public;
REVOKE ALL ON FUNCTION public.usage_top_paths(integer, integer) FROM public;
REVOKE ALL ON FUNCTION public.usage_daily_totals(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.usage_active_users(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.usage_top_paths(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.usage_daily_totals(integer) TO service_role;
