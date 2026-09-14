-- Phase 1.3 step 4a: linking a Life OS account to a LINE account.
--
-- Life OS does the linking itself through its own LINE Login channel (same
-- provider as the OA, so the user id it yields is the one Messaging API
-- pushes to — LINE docs "Getting user IDs", verified 2026-09-14). It is a
-- separate capability from Aivora SSO: a user who signed in with Google in a
-- browser has no aivora_links row and still needs this.
--
-- Two tables, both additive:
--   line_links        one row per user, written only by the server after the
--                     ID token has been verified with LINE
--   line_link_states  the OAuth `state` issued when a user starts the flow;
--                     ties the callback to the signed-in user (CSRF / login-
--                     CSRF) and expires after 10 minutes
-- Not in profiles: RLS lets a user write their own profile row, and a
-- line_user_id must only ever come from a verified ID token.
-- Not a ledger: CASCADE on account deletion is right here.
CREATE TABLE public.line_links (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- `sub` of the verified ID token. Format per LINE docs: U + 32 hex.
  line_user_id text NOT NULL UNIQUE CHECK (line_user_id ~ '^U[0-9a-f]{32}$'),
  display_name text,
  picture_url text,
  -- Whether the user has the OA as a friend, as last observed. Pushes reach
  -- nobody who is not a friend (LINE answers 200 but delivers nothing), so
  -- the UI must say clearly when this is false.
  is_friend boolean NOT NULL DEFAULT false,
  friend_checked_at timestamptz,
  linked_at timestamptz NOT NULL DEFAULT now(),
  -- Set by the sender (step 4b) when LINE reports the user blocked the OA.
  blocked_at timestamptz
);

-- The user reads their own row (Settings shows it); only the server writes.
ALTER TABLE public.line_links ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.line_links TO authenticated;
GRANT ALL ON public.line_links TO service_role;
CREATE POLICY line_links_own_read ON public.line_links
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.line_link_states (
  -- 32 random bytes, base64url. Single use: deleted when the callback consumes it.
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
-- The tick removes expired rows (abandoned flows).
CREATE INDEX line_link_states_expires_idx ON public.line_link_states (expires_at);

-- Service role only: RLS on, no policies, no grant to authenticated.
ALTER TABLE public.line_link_states ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.line_link_states TO service_role;
