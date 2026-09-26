-- Shareable "My Benefits" result
--
-- The blueprint puts this in two places: as a feature of สิทธิฉัน ("send the
-- result to your family") and under Growth & Viral as "shareable 'My Benefits'
-- result" - the loop being that someone checks their entitlements and
-- immediately sends it to a parent.
--
-- Privacy shape: a share stores a SNAPSHOT of the resulting benefit list, not
-- a live view and not the profile that produced it. The eligibility profile
-- holds age, income, household and disability details, and none of that has any
-- business travelling in a link. A snapshot also means a later profile change
-- cannot silently alter what an already-sent link shows.

CREATE TABLE IF NOT EXISTS public.benefit_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- Random, unguessable, and the only credential the public page needs.
  share_token text NOT NULL UNIQUE,
  -- [{ title, provider, estValue, summary }] as of the moment of sharing.
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Optional free-text the sender adds ("แม่ลองดูอันนี้นะ").
  message text NOT NULL DEFAULT '',
  view_count integer NOT NULL DEFAULT 0,
  -- Links die on their own. A benefits result goes stale as rules change, and
  -- an unbounded public link is a standing disclosure.
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS benefit_shares_token_idx ON public.benefit_shares (share_token);
CREATE INDEX IF NOT EXISTS benefit_shares_user_idx ON public.benefit_shares (user_id, created_at DESC);

ALTER TABLE public.benefit_shares ENABLE ROW LEVEL SECURITY;

-- Only the sender can see or manage their own shares. The public page is
-- served by a server function using the service-role client, which checks the
-- token, expiry and revocation itself - there is deliberately no anon SELECT
-- policy here, so a leaked anon key cannot enumerate the table.
CREATE POLICY benefit_shares_own ON public.benefit_shares
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
