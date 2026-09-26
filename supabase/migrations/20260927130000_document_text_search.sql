-- Searching inside documents, not just their titles.
--
-- Universal Search matched title, category and counterparty with ILIKE, so a
-- user who remembered a word from the body of a warranty could not find it. The
-- AI analysis already stores what it read - a summary and an `extracted` object
-- with the fields it pulled out - and that is the searchable content of the
-- document as far as this app is concerned.
--
-- Trigrams rather than tsvector, on purpose: Postgres has no Thai parser, and
-- Thai does not put spaces between words, so to_tsvector would produce one
-- enormous token per sentence and full-text search would match almost nothing.
-- A GIN trigram index makes ILIKE '%คำ%' fast and works the same in both
-- languages, which is what this app actually needs.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generated, so it cannot drift from the columns it is built from.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS search_text text
  GENERATED ALWAYS AS (
    coalesce(title, '') || ' ' ||
    coalesce(summary, '') || ' ' ||
    coalesce(counterparty, '') || ' ' ||
    coalesce(category, '') || ' ' ||
    coalesce(extracted::text, '')
  ) STORED;

CREATE INDEX IF NOT EXISTS documents_search_text_trgm
  ON public.documents USING gin (search_text gin_trgm_ops);

-- The same for the two other places people search prose: legacy notes and
-- decision questions.
CREATE INDEX IF NOT EXISTS legacy_wishes_body_trgm
  ON public.legacy_wishes USING gin ((coalesce(title,'') || ' ' || coalesce(body,'')) gin_trgm_ops);
