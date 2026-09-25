-- Round 3: warranty tracking on documents

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS warranty_until date,
  ADD COLUMN IF NOT EXISTS is_warranty boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS documents_due_date_idx
  ON public.documents (user_id, due_date)
  WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS documents_warranty_idx
  ON public.documents (user_id, warranty_until)
  WHERE warranty_until IS NOT NULL;
