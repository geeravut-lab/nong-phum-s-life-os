-- Notification text that can be shown in the reader's language.
--
-- A notification is written on the server, at the moment something happens, and
-- stored - so the Thai sentence in the row is fixed forever, whatever language
-- the person who opens it reads. Errors were fixed by sending a code and
-- translating on the client; a stored row needs the same treatment plus the
-- values that go in the sentence ("instalment 3", "฿1,200").
--
-- title and body stay: they are the fallback for rows written before this, for
-- kinds with no template yet, and for LINE, which receives text rather than a
-- key. Nothing has to be backfilled.

ALTER TABLE public.app_notifications
  ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.app_notifications.params IS
  'Values for the kind''s template, e.g. {"seq": 3}. Empty when the row predates templates.';
