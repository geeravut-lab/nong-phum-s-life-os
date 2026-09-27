-- Trip plans that survive leaving the page.
--
-- The plan was React state and nothing else, so walking to another menu and
-- coming back lost everything the user had assembled - which is exactly when
-- people leave to check an opening time or a price. Saving it also makes the
-- plan reusable: the same three stops on a different Saturday.
--
-- The stops are stored as jsonb rather than rows in a join table on purpose: a
-- plan is a snapshot of what the user picked, and if a shop later changes its
-- name or closes, the plan should still read the way it did when it was saved.
-- A foreign key per stop would rewrite history and could empty a saved plan.

CREATE TABLE IF NOT EXISTS public.trip_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  /** [{id,title,lat,lng,startsAt,address,venue,placeId}] - the Stop shape. */
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_plans_user_idx ON public.trip_plans (user_id, updated_at DESC);

ALTER TABLE public.trip_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trip_plans_own ON public.trip_plans;
CREATE POLICY trip_plans_own ON public.trip_plans
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_plans TO authenticated;
GRANT ALL ON public.trip_plans TO service_role;
