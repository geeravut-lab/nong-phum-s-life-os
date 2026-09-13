-- Aivora Hub SSO: which auth.users row belongs to which hub identity.
--
-- The hub's user.id is the ONLY key we link on. Linking by e-mail would let a
-- hub ticket take over an account someone created here with the same address,
-- and the hub does not tell us whether that address was ever verified. The
-- same id is also stamped into auth.users.app_metadata.aivora_user_id at
-- creation time; this table is the indexed lookup for it.
CREATE TABLE public.aivora_links (
  aivora_user_id text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Written and read only by the server through the service role. No client
-- ever needs this table, so there are no GRANTs to authenticated and no
-- policies at all: with RLS on and no policy, every non-service request is
-- refused.
ALTER TABLE public.aivora_links ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.aivora_links TO service_role;
