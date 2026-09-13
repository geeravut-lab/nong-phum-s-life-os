-- Phase 1.2: audit trail for self-service account deletion.
--
-- One row per deleted account, written by the server just before
-- auth.admin.deleteUser(). user_id is deliberately NOT a foreign key: the
-- whole point is that the user no longer exists afterwards. What is kept is
-- enough to answer "when did this person delete their account and what went
-- with it", which is the basis for a PDPA request later — not the data itself.
CREATE TABLE public.account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  display_name text,
  aivora_user_id text,
  -- {"documents": 3, "expenses": 12, ...} plus storage_files and families_dissolved
  removed jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by text NOT NULL DEFAULT 'self' CHECK (requested_by IN ('self', 'admin')),
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_deletions_deleted_at_idx ON public.account_deletions (deleted_at DESC);

-- Service role only: RLS on, no policies, no grant to authenticated. Admins
-- can read it through a future admin page (has_role policy) if ever needed.
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.account_deletions TO service_role;
