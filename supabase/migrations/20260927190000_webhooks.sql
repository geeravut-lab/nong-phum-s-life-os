-- Outbound webhooks: the part of "integrations" that needs nothing from anyone.
--
-- Email, calendar and cloud storage all need an OAuth app registered with
-- Google or Microsoft, with a consent screen and credentials that cannot be
-- written into the repository ahead of time. A webhook needs none of that: the
-- user supplies a url they control, and whatever is on the other end - Make,
-- n8n, Zapier, their own script - does the emailing or the calendar entry.
--
-- So this is the lever that unblocks the rest, and it is also the action half
-- that any future rules engine would need anyway.
--
-- The secret is generated here rather than by the client so that it is a real
-- random value, and it is shown to the user once: every delivery is signed with
-- it, and a receiver that does not check the signature is accepting posts from
-- anyone who guesses the url.

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  /** Notification kinds to send. Empty array means every kind. */
  events text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  last_status integer,
  last_at timestamptz,
  /** Consecutive failures; the sender gives up on an endpoint that keeps failing. */
  failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_endpoints_url_https CHECK (url LIKE 'https://%')
);

CREATE INDEX IF NOT EXISTS webhook_endpoints_user_idx ON public.webhook_endpoints (user_id);

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

-- The secret is deliberately not readable from the client after creation: the
-- select policy exists so a user can see their own endpoints, and the server
-- function that lists them leaves the secret out.
DROP POLICY IF EXISTS webhook_endpoints_own ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_own ON public.webhook_endpoints
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.webhook_endpoints TO authenticated;
GRANT ALL ON public.webhook_endpoints TO service_role;
