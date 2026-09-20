-- "สนับสนุน" — voluntary PromptPay donations, modelled on the Harmony playbook
-- (KNOWLEDGE_donation_support_admin_ui.md). Two tables.
--
-- Principles carried over, each enforced here at the database, not only in
-- the UI:
--   * a donation never touches any user permission — nothing here references
--     user_roles or any plan/feature column, and nothing ever will
--   * the client can only ever create a row as 'pending'; confirming is an
--     admin act that leaves an audit trail (who, when)
--   * reports count status = 'confirmed' only (a partial index makes that the
--     cheap path)
--   * every row keeps a snapshot of the PromptPay id it was paid to, so the
--     ledger stays meaningful after the receiving account changes
--
-- donations.user_id is deliberately NOT a foreign key: this is an income
-- ledger (same choice as account_deletions and notification_log). Account
-- deletion anonymises the row (see account.server.ts) instead of removing it.

CREATE TABLE public.donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- What the donor chose to show. Anonymous rows carry no email and a fixed
  -- display name; that is a property of the stored row, not of the UI.
  anonymous boolean NOT NULL DEFAULT false,
  display_name text,
  email text,
  amount_baht numeric(10, 2) NOT NULL CHECK (amount_baht >= 1 AND amount_baht <= 100000),
  -- Snapshot of donation_settings.promptpay_id at the time of the transfer.
  promptpay_id text NOT NULL,
  -- Slip reference or last digits, typed by the donor; helps the admin match
  -- the bank statement. Optional.
  ref text CHECK (ref IS NULL OR char_length(ref) <= 40),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Audit trail, written only when an admin settles the row.
  confirmed_at timestamptz,
  confirmed_by uuid
);
CREATE INDEX donations_user_created_idx ON public.donations (user_id, created_at DESC);
CREATE INDEX donations_pending_idx ON public.donations (created_at) WHERE status = 'pending';
CREATE INDEX donations_confirmed_idx ON public.donations (confirmed_at DESC) WHERE status = 'confirmed';

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.donations TO authenticated;
GRANT ALL ON public.donations TO service_role;

-- The four rules that must not be relaxed (playbook §4.2), as policies:
--   1. the client creates 'pending' only
--   2. amount clamped 1–100,000 (the CHECK above; the policy repeats it so a
--      relaxed CHECK later cannot silently widen what a client may insert)
--   3. no audit columns at creation
--   4. update only by admins — a donor can never move their own row
CREATE POLICY donations_insert_own_pending ON public.donations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND amount_baht >= 1 AND amount_baht <= 100000
    AND confirmed_at IS NULL
    AND confirmed_by IS NULL
  );
CREATE POLICY donations_read_own_or_admin ON public.donations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY donations_admin_update ON public.donations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- No DELETE grant to authenticated at all: a ledger row is settled, never removed.


-- Settings the admin edits: receiving PromptPay id, on/off, and the
-- "what the money is used for" text — the single most decision-relevant
-- string in the feature, hence multi-line and never hard-coded.
CREATE TABLE public.donation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Digits only; 10 (mobile), 13 (citizen id) or 15 (e-wallet). NULL = not set up.
  promptpay_id text CHECK (promptpay_id IS NULL OR promptpay_id ~ '^[0-9]{10}$|^[0-9]{13}$|^[0-9]{15}$'),
  enabled boolean NOT NULL DEFAULT false,
  purpose text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, UPDATE ON public.donation_settings TO authenticated;
GRANT ALL ON public.donation_settings TO service_role;
ALTER TABLE public.donation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY donation_settings_read ON public.donation_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY donation_settings_admin_write ON public.donation_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_donation_settings_updated
  BEFORE UPDATE ON public.donation_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.donation_settings (id) VALUES (true);
