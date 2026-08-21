-- roles
CREATE TYPE public.app_role AS ENUM ('admin','member');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  display_name TEXT,
  language TEXT NOT NULL DEFAULT 'th',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_own" ON public.profiles FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_read_own" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- families
CREATE TABLE public.families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL,
  invite_code TEXT NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.families TO authenticated;
GRANT ALL ON public.families TO service_role;
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  member_role TEXT NOT NULL DEFAULT 'member',
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_members TO authenticated;
GRANT ALL ON public.family_members TO service_role;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_family_member(_family_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.family_members WHERE family_id = _family_id AND user_id = _user_id)
$$;

CREATE POLICY "families_member_read" ON public.families FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_family_member(id, auth.uid()));
CREATE POLICY "families_owner_insert" ON public.families FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "families_owner_update" ON public.families FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "families_owner_delete" ON public.families FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "family_members_read" ON public.family_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_family_member(family_id, auth.uid()));
CREATE POLICY "family_members_insert_self" ON public.family_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "family_members_update_self" ON public.family_members FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "family_members_delete_self_or_owner" ON public.family_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.owner_id = auth.uid()));

-- documents
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  family_id UUID REFERENCES public.families(id) ON DELETE SET NULL,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  storage_path TEXT,
  mime_type TEXT,
  summary TEXT,
  doc_date DATE,
  due_date DATE,
  amount NUMERIC(14,2),
  counterparty TEXT,
  extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents_own" ON public.documents FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "documents_family_read" ON public.documents FOR SELECT TO authenticated
  USING (is_shared AND family_id IS NOT NULL AND public.is_family_member(family_id, auth.uid()));

-- reminders
CREATE TABLE public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  family_id UUID REFERENCES public.families(id) ON DELETE SET NULL,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL,
  notes TEXT,
  due_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  recurrence TEXT NOT NULL DEFAULT 'none',
  source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT ALL ON public.reminders TO service_role;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reminders_own" ON public.reminders FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "reminders_family_read" ON public.reminders FOR SELECT TO authenticated
  USING (is_shared AND family_id IS NOT NULL AND public.is_family_member(family_id, auth.uid()));

-- expenses
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  family_id UUID REFERENCES public.families(id) ON DELETE SET NULL,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  spent_on DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  note TEXT,
  source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_own" ON public.expenses FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "expenses_family_read" ON public.expenses FOR SELECT TO authenticated
  USING (is_shared AND family_id IS NOT NULL AND public.is_family_member(family_id, auth.uid()));

-- chat
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  action JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_own" ON public.chat_messages FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_documents_updated BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_reminders_updated BEFORE UPDATE ON public.reminders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- auto profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE INDEX idx_documents_user ON public.documents(user_id, created_at DESC);
CREATE INDEX idx_reminders_user ON public.reminders(user_id, due_at);
CREATE INDEX idx_expenses_user ON public.expenses(user_id, spent_on DESC);
CREATE INDEX idx_chat_user ON public.chat_messages(user_id, created_at);