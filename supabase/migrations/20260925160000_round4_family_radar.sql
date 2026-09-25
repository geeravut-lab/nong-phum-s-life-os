-- Round 4: Family Radar depth

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS assignee_user_id uuid;

CREATE INDEX IF NOT EXISTS reminders_assignee_idx
  ON public.reminders (assignee_user_id)
  WHERE assignee_user_id IS NOT NULL;

-- Shared family calendar
CREATE TABLE IF NOT EXISTS public.family_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_events_family_starts_idx
  ON public.family_events (family_id, starts_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_events TO authenticated;
GRANT ALL ON public.family_events TO service_role;
ALTER TABLE public.family_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_events_member ON public.family_events
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.family_members m
      WHERE m.family_id = family_events.family_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.family_members m
      WHERE m.family_id = family_events.family_id AND m.user_id = auth.uid()
    )
  );

CREATE TRIGGER trg_family_events_updated BEFORE UPDATE ON public.family_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Care check-ins
CREATE TABLE IF NOT EXISTS public.family_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'need_help', 'emergency')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_checkins_family_created_idx
  ON public.family_checkins (family_id, created_at DESC);

CREATE INDEX IF NOT EXISTS family_checkins_user_day_idx
  ON public.family_checkins (user_id, created_at DESC);

GRANT SELECT, INSERT ON public.family_checkins TO authenticated;
GRANT ALL ON public.family_checkins TO service_role;
ALTER TABLE public.family_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_checkins_member ON public.family_checkins
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.family_members m
      WHERE m.family_id = family_checkins.family_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY family_checkins_insert_own ON public.family_checkins
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.family_members m
      WHERE m.family_id = family_checkins.family_id AND m.user_id = auth.uid()
    )
  );

-- Per-member data category permissions (owner manages)
CREATE TABLE IF NOT EXISTS public.family_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  can_view_docs boolean NOT NULL DEFAULT true,
  can_view_tasks boolean NOT NULL DEFAULT true,
  can_view_expenses boolean NOT NULL DEFAULT true,
  can_view_calendar boolean NOT NULL DEFAULT true,
  can_edit_shared boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.family_permissions TO authenticated;
GRANT ALL ON public.family_permissions TO service_role;
ALTER TABLE public.family_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_permissions_select ON public.family_permissions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.families f
      WHERE f.id = family_permissions.family_id AND f.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.family_members m
      WHERE m.family_id = family_permissions.family_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY family_permissions_owner_write ON public.family_permissions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.families f
      WHERE f.id = family_permissions.family_id AND f.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.families f
      WHERE f.id = family_permissions.family_id AND f.owner_id = auth.uid()
    )
  );
