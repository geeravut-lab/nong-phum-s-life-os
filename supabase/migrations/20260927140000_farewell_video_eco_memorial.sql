-- Two gaps in the memorial side of Life Legacy.
--
-- 1) The farewell video could only be a link to somewhere else. A family that
--    recorded a video on a phone had nowhere to put it, and a YouTube upload is
--    not something you ask a grieving family to do. video_url now also accepts
--    'storage:<path>', a file in the documents bucket, which the memorial page
--    resolves to a short-lived signed url - so the video stays private to
--    whoever has the memorial link rather than being public on the internet.
--
-- 2) The digital wreath had one shape: a wreath. The spec also asks for the eco
--    option - donate a tree in the person's name instead - which is the same
--    transaction with a different meaning, so it is a kind on the existing row
--    rather than a second table.

ALTER TABLE public.digital_wreaths
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'wreath',
  -- Who plants it. Free text: the partner will change, and a foreign key to a
  -- table of one row helps nobody.
  ADD COLUMN IF NOT EXISTS tree_partner text;

ALTER TABLE public.digital_wreaths DROP CONSTRAINT IF EXISTS digital_wreaths_kind_check;
ALTER TABLE public.digital_wreaths ADD CONSTRAINT digital_wreaths_kind_check CHECK (
  kind IN ('wreath', 'tree')
);

CREATE INDEX IF NOT EXISTS digital_wreaths_memorial_kind_idx
  ON public.digital_wreaths (memorial_id, kind);
