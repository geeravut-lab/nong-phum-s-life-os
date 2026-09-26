-- Will & Estate - section 6 of the twelve the Life Legacy spec says a user sees
--
-- SCOPE, and it is deliberate: this records WHERE the real will is and who to
-- contact about it. It does not draft, hold or execute a will. A will has
-- formal requirements under Thai law (witnesses, or registration at the
-- amphoe) that no application satisfies by storing text, and the project
-- principle is explicit: keep "a copy and the location of the real document",
-- never "make a will". The UI states this on the page.
--
-- That scope is also why there is no "will_text" column. Somewhere to type the
-- will would invite people to believe the typing was the will.

CREATE TABLE IF NOT EXISTS public.legacy_will (
  -- One per user: this is a statement about their affairs, not a list.
  user_id uuid PRIMARY KEY,
  has_will boolean NOT NULL DEFAULT false,
  -- handwritten | amphoe | lawyer | other - how the real document was made,
  -- which is what determines where it will be found.
  will_kind text NOT NULL DEFAULT 'other'
    CHECK (will_kind IN ('handwritten', 'amphoe', 'lawyer', 'other')),
  made_on date,
  -- Free text on purpose: "in the safe in the bedroom, brown envelope".
  location_hint text NOT NULL DEFAULT '',
  executor_name text NOT NULL DEFAULT '',
  executor_contact text NOT NULL DEFAULT '',
  lawyer_name text NOT NULL DEFAULT '',
  lawyer_contact text NOT NULL DEFAULT '',
  -- Optional scan already in the archive. Kept as a reference rather than a
  -- copy so deletion of the document removes the file exactly once.
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.legacy_will ENABLE ROW LEVEL SECURITY;

-- Strictly the owner. Unlike the rest of Life Legacy, nothing here is released
-- to trusted contacts automatically: who may see a will, and when, is a legal
-- question the product principles say must not be decided by this system.
CREATE POLICY legacy_will_own ON public.legacy_will
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
