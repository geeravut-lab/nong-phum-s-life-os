-- The same file uploaded twice filed a second set of money rows.
--
-- Nothing compared an upload against what was already in the vault, so
-- re-sending a statement - which people do when they are not sure it went
-- through - doubled every expense and income on it. The totals were then
-- wrong with no visible cause: the rows look legitimate one by one.
--
-- A SHA-256 of the file's bytes is what identifies it. The name is not: the
-- same scan saved twice by a phone is Notes_001932.pdf and Notes_001933.pdf,
-- and two genuinely different receipts can share a name.
--
-- Nullable, because every document already in the vault predates this. Those
-- rows are simply never matched, which is the right answer: we cannot know
-- what they contained without downloading each one.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_hash text;

-- Per user, not globally: two people uploading the same public form is not a
-- duplicate of anything, and one account's hashes should not be visible in
-- the shape of another's index.
CREATE INDEX IF NOT EXISTS documents_user_hash_idx
  ON public.documents (user_id, content_hash)
  WHERE content_hash IS NOT NULL;

COMMENT ON COLUMN public.documents.content_hash IS
  'SHA-256 of the uploaded bytes, lowercase hex. Used to spot a re-upload of the same file before it is filed a second time.';
