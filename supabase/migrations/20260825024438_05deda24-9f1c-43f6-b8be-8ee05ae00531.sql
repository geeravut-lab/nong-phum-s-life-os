CREATE TABLE public.incomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  family_id uuid REFERENCES public.families(id),
  is_shared boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  amount numeric NOT NULL DEFAULT 0,
  received_on date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  source_document_id uuid REFERENCES public.documents(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.incomes TO authenticated;
GRANT ALL ON public.incomes TO service_role;

ALTER TABLE public.incomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY incomes_own ON public.incomes FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY incomes_family_read ON public.incomes FOR SELECT TO authenticated
  USING (is_shared AND family_id IS NOT NULL AND public.is_family_member(family_id, auth.uid()));

CREATE TRIGGER incomes_set_updated_at BEFORE UPDATE ON public.incomes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();