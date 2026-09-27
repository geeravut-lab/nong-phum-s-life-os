-- A link to the user manual, set by an admin, opened by everyone.
--
-- The manual is a PDF that lives outside this system (Dropbox, Drive, wherever
-- the owner keeps it), so what we store is a URL and not a file. Keeping it in
-- platform_settings means it is readable by every signed-in user through the
-- policy that is already there, and writable only by an admin through the one
-- next to it - no new table and no new policy.
--
-- Empty means "no manual yet", and the menu entry stays hidden rather than
-- offering a link that goes nowhere.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS manual_url text NOT NULL DEFAULT '';
