-- AI Funeral Planner: the part after the AI.
--
-- The planner already asked the questions, produced three packages with line
-- items, a timeline and providers, and took a PromptPay payment in one go. What
-- the spec asks for around that is a conversation with a human:
--
--   user picks a package  →  admin is told, and goes to contact the venue,
--   the monks, the caterer  →  admin says in the system whether it can be done
--   →  user chooses to arrange it themselves or to have the platform do it  →
--   if the platform, the package is paid once or over 12/24/36 months  →  admin
--   takes out the insurance that pays the user's named representative when the
--   time comes, and uploads the evidence for the user to check.
--
-- So a plan needs to remember where it is in that exchange, an instalment plan
-- needs dates rather than one divided number, and there has to be somewhere to
-- put the paperwork.

-- 'confirmed' sits between selected and paid: the admin has checked the package
-- can actually be delivered.
ALTER TABLE public.funeral_plans DROP CONSTRAINT IF EXISTS funeral_plans_status_check;
ALTER TABLE public.funeral_plans ADD CONSTRAINT funeral_plans_status_check CHECK (
  status IN ('draft','selected','confirmed','paid','in_progress','done','cancelled')
);

ALTER TABLE public.funeral_plans
  ADD COLUMN IF NOT EXISTS fulfilment text NOT NULL DEFAULT 'undecided',
  ADD COLUMN IF NOT EXISTS admin_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS admin_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Who the insurance should pay when the time comes. A name and a way to reach
  -- them, not a link to an account: this person may not use the app at all.
  ADD COLUMN IF NOT EXISTS representative_name text,
  ADD COLUMN IF NOT EXISTS representative_contact text;

ALTER TABLE public.funeral_plans DROP CONSTRAINT IF EXISTS funeral_plans_fulfilment_check;
ALTER TABLE public.funeral_plans ADD CONSTRAINT funeral_plans_fulfilment_check CHECK (
  fulfilment IN ('undecided','self','platform')
);
ALTER TABLE public.funeral_plans DROP CONSTRAINT IF EXISTS funeral_plans_admin_status_check;
ALTER TABLE public.funeral_plans ADD CONSTRAINT funeral_plans_admin_status_check CHECK (
  admin_status IN ('none','reviewing','confirmed','declined')
);

-- One row per instalment, with the date it is due.
--
-- The old code divided the total by 12 and produced a single amount, which
-- cannot answer "what do I owe this month" or "how many have I paid". Rounding
-- goes on the first row so the instalments still add up to the package price.
CREATE TABLE IF NOT EXISTS public.funeral_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.funeral_plans(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  due_on date NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  payment_status text NOT NULL DEFAULT 'due' CHECK (payment_status IN ('due','paid','cancelled')),
  paid_at timestamptz,
  payer_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, seq)
);

CREATE INDEX IF NOT EXISTS funeral_installments_plan_idx
  ON public.funeral_installments (plan_id, seq);

ALTER TABLE public.funeral_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funeral_installments_read ON public.funeral_installments;
CREATE POLICY funeral_installments_read ON public.funeral_installments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.funeral_plans p
      WHERE p.id = funeral_installments.plan_id AND p.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );

GRANT SELECT ON public.funeral_installments TO authenticated;
GRANT ALL ON public.funeral_installments TO service_role;

-- The paperwork: who was contacted, and the insurance that will pay out.
--
-- Files live in the existing documents bucket under the plan owner's own
-- folder, so the read policy that already exists there covers them; the admin
-- writes them through the service role, which storage RLS does not apply to.
CREATE TABLE IF NOT EXISTS public.funeral_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.funeral_plans(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('provider_contact','insurance','payment','other')),
  title text NOT NULL,
  note text NOT NULL DEFAULT '',
  /** Path inside the documents bucket; null when the note is the whole record. */
  file_path text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funeral_evidence_plan_idx ON public.funeral_evidence (plan_id);

ALTER TABLE public.funeral_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funeral_evidence_read ON public.funeral_evidence;
CREATE POLICY funeral_evidence_read ON public.funeral_evidence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.funeral_plans p
      WHERE p.id = funeral_evidence.plan_id AND p.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );

GRANT SELECT ON public.funeral_evidence TO authenticated;
GRANT ALL ON public.funeral_evidence TO service_role;

-- Admins need to read every plan and payment to work the queue; owners already
-- can read their own through the policies added when those tables were created.
DROP POLICY IF EXISTS funeral_plans_admin_read ON public.funeral_plans;
CREATE POLICY funeral_plans_admin_read ON public.funeral_plans
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS funeral_payments_admin_read ON public.funeral_payments;
CREATE POLICY funeral_payments_admin_read ON public.funeral_payments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
