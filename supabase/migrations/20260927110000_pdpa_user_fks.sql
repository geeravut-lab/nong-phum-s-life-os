-- Deleting a user must delete their data (PDPA), and until now it mostly did not.
--
-- An earlier migration wired a dozen tables to auth.users with ON DELETE
-- CASCADE, and the account-deletion flow was written believing that covered
-- everything - it removes storage files, anonymises the donation ledger, writes
-- an audit row and then calls auth.admin.deleteUser, trusting the cascade for
-- the rest. But 34 user columns had no foreign key at all, so every legacy
-- plan, wish, asset, will, funeral plan, decision, review, memorial, payment
-- and notification of a deleted user stayed behind with nothing pointing at it.
--
-- Two behaviours, chosen per column rather than per table:
--
--   CASCADE  - the row IS that person's record. It goes when they go.
--   SET NULL - the row belongs to someone else (a family event they created, a
--              condolence on another person's memorial) or to the platform's
--              own ledgers and audit trail. The row stays; the link to the
--              person does not.
--
-- The audit tables are the reason SET NULL exists here at all: account_deletions
-- is written immediately before the user disappears, so a cascade would delete
-- the very record that proves the deletion happened.
--
-- Orphans already in the table are resolved the same way before the constraint
-- is added - deleted for CASCADE columns, nulled for SET NULL ones - because an
-- orphan is exactly what this migration exists to prevent. The constraints are
-- then added as validated, so the table is known clean afterwards.

DO $$
DECLARE
  rec record;
  fk_name text;
  n integer;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- The person's own records.
      ('ai_usage_monthly',      'user_id',          'cascade'),
      ('app_notifications',     'user_id',          'cascade'),
      ('benefit_shares',        'user_id',          'cascade'),
      ('death_cases',           'subject_user_id',  'cascade'),
      ('decisions',             'user_id',          'cascade'),
      ('family_checkins',       'user_id',          'cascade'),
      ('family_permissions',    'user_id',          'cascade'),
      ('family_routines',       'subject_user_id',  'cascade'),
      ('funeral_plans',         'user_id',          'cascade'),
      ('legacy_assets',         'user_id',          'cascade'),
      ('legacy_checklist',      'user_id',          'cascade'),
      ('legacy_contacts',       'user_id',          'cascade'),
      ('legacy_profiles',       'user_id',          'cascade'),
      ('legacy_will',           'user_id',          'cascade'),
      ('legacy_wishes',         'user_id',          'cascade'),
      ('local_events',          'owner_user_id',    'cascade'),
      ('local_places',          'owner_user_id',    'cascade'),
      ('memorials',             'subject_user_id',  'cascade'),
      ('notification_log',      'user_id',          'cascade'),
      ('place_reviews',         'user_id',          'cascade'),
      ('post_life_actions',     'subject_user_id',  'cascade'),
      ('usage_daily',           'user_id',          'cascade'),
      ('user_subscriptions',    'user_id',          'cascade'),
      -- Someone else's row, or the platform's ledger and audit trail.
      ('account_deletions',     'user_id',          'setnull'),
      ('privacy_audit_log',     'user_id',          'setnull'),
      ('donations',             'user_id',          'setnull'),
      ('premium_payments',      'user_id',          'setnull'),
      ('death_notify_messages', 'created_by',       'setnull'),
      ('family_events',         'created_by',       'setnull'),
      ('family_routines',       'created_by',       'setnull'),
      ('memorial_messages',     'created_by',       'setnull'),
      ('memorials',             'created_by',       'setnull'),
      ('reminders',             'assignee_user_id', 'setnull'),
      ('routine_logs',          'logged_by',        'setnull')
    ) AS t(tbl, col, action)
  LOOP
    -- Tables are created by earlier migrations; skip anything absent rather
    -- than failing a whole deployment on one missing table.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = rec.tbl AND column_name = rec.col
    ) THEN
      RAISE NOTICE 'skip %.% (no such column)', rec.tbl, rec.col;
      CONTINUE;
    END IF;

    -- Idempotent: a column that already points at auth.users is left alone.
    IF EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_attribute a
        ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
      WHERE con.conrelid = format('public.%I', rec.tbl)::regclass
        AND con.contype = 'f'
        AND a.attname = rec.col
    ) THEN
      CONTINUE;
    END IF;

    IF rec.action = 'setnull' THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', rec.tbl, rec.col);
      EXECUTE format(
        'UPDATE public.%I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = public.%I.%I)',
        rec.tbl, rec.col, rec.col, rec.tbl, rec.col
      );
    ELSE
      EXECUTE format(
        'DELETE FROM public.%I WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = public.%I.%I)',
        rec.tbl, rec.col, rec.tbl, rec.col
      );
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        RAISE NOTICE 'removed % orphan row(s) from %.%', n, rec.tbl, rec.col;
      END IF;
    END IF;

    fk_name := rec.tbl || '_' || rec.col || '_fkey';
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE %s',
      rec.tbl, fk_name, rec.col,
      CASE WHEN rec.action = 'setnull' THEN 'SET NULL' ELSE 'CASCADE' END
    );
  END LOOP;
END $$;

-- An index on every one of these columns: without it each user delete has to
-- sequentially scan the child table to find the rows to cascade, and the same
-- goes for "everything belonging to this person" reads.
DO $$
DECLARE
  rec record;
  idx text;
BEGIN
  FOR rec IN
    SELECT c.relname AS tbl, a.attname AS col
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (con.conkey)
    WHERE n.nspname = 'public'
      AND con.contype = 'f'
      AND con.confrelid = 'auth.users'::regclass
      AND array_length(con.conkey, 1) = 1
  LOOP
    idx := rec.tbl || '_' || rec.col || '_idx';
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = idx
    ) THEN
      EXECUTE format('CREATE INDEX %I ON public.%I (%I)', idx, rec.tbl, rec.col);
    END IF;
  END LOOP;
END $$;
