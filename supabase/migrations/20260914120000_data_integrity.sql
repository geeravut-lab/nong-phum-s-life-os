-- Phase 1.2: data integrity & deletion path.
--
-- Until now no public table referenced auth.users, so deleting a user left
-- every row it owned behind (confirmed in Phase 0). This migration adds the
-- missing foreign keys, repairs two existing ones on incomes that lacked an
-- ON DELETE action, moves the date defaults to Bangkok time, and adds the two
-- documents columns the attachments work (1.9) and the orphan-file fix need,
-- so that work will not require a second migration.
--
-- Pre-flight, verified 2026-09-14 against production before writing this:
--   * 0 orphan rows in every table below (every user id exists in auth.users)
--   * ai_settings.updated_by points at an existing user
--   * 1 storage object has no documents row — that is a file, not a row, and
--     is removed through the Storage API outside this migration
-- supabase db push wraps the whole file in one transaction, so it applies
-- entirely or not at all. Every statement here is reversible: DROP CONSTRAINT / SET DEFAULT /
-- DROP COLUMN undo it without touching data. Nothing here deletes rows.
--
-- What ON DELETE CASCADE on auth.users will remove from now on is listed in
-- docs/PHASE-1-PLAN.md §1.2 "การลบบัญชี". Two consequences worth repeating:
--   * families.owner_id CASCADE: an owner deleting their account dissolves
--     the family — members' shared items become private (family_id SET NULL),
--     nothing of theirs is deleted. Ownership transfer is a follow-up feature.
--   * Storage files are NOT touched by any of this. Account deletion must go
--     through a server function that removes files via the Storage API first.


-- ---------------------------------------------------------------------------
-- 1. Repair the two incomes foreign keys that had no ON DELETE action.
--    NO ACTION meant deleting a family or a document referenced by an income
--    row failed outright. reminders/expenses/documents already use SET NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE public.incomes
  DROP CONSTRAINT incomes_family_id_fkey,
  ADD CONSTRAINT incomes_family_id_fkey
    FOREIGN KEY (family_id) REFERENCES public.families(id) ON DELETE SET NULL;

ALTER TABLE public.incomes
  DROP CONSTRAINT incomes_source_document_id_fkey,
  ADD CONSTRAINT incomes_source_document_id_fkey
    FOREIGN KEY (source_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. Foreign keys to auth.users. aivora_links already has one (with CASCADE)
--    and is the model for these. Constraint names follow Supabase's
--    <table>_<column>_fkey convention so `supabase gen types` picks them up.
-- ---------------------------------------------------------------------------

-- profiles is keyed directly on the user id.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.incomes
  ADD CONSTRAINT incomes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.benefit_profiles
  ADD CONSTRAINT benefit_profiles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_benefits
  ADD CONSTRAINT user_benefits_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.helper_profiles
  ADD CONSTRAINT helper_profiles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- job_offers already cascades through helper_id → helper_profiles; this makes
-- the denormalised helper_user_id column honest on its own as well.
ALTER TABLE public.job_offers
  ADD CONSTRAINT job_offers_helper_user_id_fkey
    FOREIGN KEY (helper_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.job_reviews
  ADD CONSTRAINT job_reviews_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Deleting the owner dissolves the family (family_members cascade from
-- families; members' shared rows get family_id = NULL and stay theirs).
-- Ownership transfer before deletion is tracked as a follow-up in the plan.
ALTER TABLE public.families
  ADD CONSTRAINT families_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.family_members
  ADD CONSTRAINT family_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- An audit pointer, not ownership: it must never block deleting an admin.
ALTER TABLE public.ai_settings
  ADD CONSTRAINT ai_settings_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. Date defaults in Bangkok time (Phase 1.8 follow-up).
--    App code always sends these columns explicitly, so CURRENT_DATE (UTC on
--    Supabase) has never been hit — but it would be wrong for anything that
--    inserts from SQL or a script between 00:00 and 07:00 Bangkok.
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses
  ALTER COLUMN spent_on SET DEFAULT (now() AT TIME ZONE 'Asia/Bangkok')::date;

ALTER TABLE public.incomes
  ALTER COLUMN received_on SET DEFAULT (now() AT TIME ZONE 'Asia/Bangkok')::date;

-- ---------------------------------------------------------------------------
-- 4. documents.kind / documents.status — the two columns Phase 1.9 needs.
--
--    kind    'analyzed'   uploaded through the AI intake (today's only path)
--            'attachment' a receipt attached to an existing expense/income/
--                         reminder without AI; the Docs page can filter these
--                         and the intake must never turn one into a new row
--    status  'ready'      normal
--            'pending'    row created before the file is uploaded/analysed,
--                         so a file can no longer exist without a row — this
--                         is what closes the orphan-file hole
--            'failed'     upload or analysis failed; a cron (1.3) sweeps these
--
--    Existing rows are all AI-analysed and complete, so the defaults are the
--    correct backfill.
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN kind text NOT NULL DEFAULT 'analyzed'
    CHECK (kind IN ('analyzed', 'attachment')),
  ADD COLUMN status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('pending', 'ready', 'failed'));

-- Documents that never finished should not clutter lists or feed the AI context.
CREATE INDEX documents_status_idx ON public.documents (user_id, status);

