-- helper profiles
CREATE TABLE public.helper_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  bio text,
  skills text[] NOT NULL DEFAULT '{}',
  area text,
  lat double precision,
  lng double precision,
  available_from time,
  available_to time,
  hourly_rate numeric,
  is_active boolean NOT NULL DEFAULT true,
  is_verified boolean NOT NULL DEFAULT false,
  rating numeric NOT NULL DEFAULT 0,
  jobs_done integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.helper_profiles TO authenticated;
GRANT ALL ON public.helper_profiles TO service_role;
ALTER TABLE public.helper_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY helper_profiles_own ON public.helper_profiles FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY helper_profiles_read_active ON public.helper_profiles FOR SELECT TO authenticated
  USING (is_active);
CREATE TRIGGER trg_helper_profiles_updated BEFORE UPDATE ON public.helper_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- jobs
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other',
  location_text text,
  lat double precision,
  lng double precision,
  scheduled_at timestamptz,
  budget_min numeric,
  budget_max numeric,
  status text NOT NULL DEFAULT 'open',
  assigned_helper_id uuid REFERENCES public.helper_profiles(id) ON DELETE SET NULL,
  agreed_price numeric,
  platform_fee numeric,
  ai_extract jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_own ON public.jobs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY jobs_read_open ON public.jobs FOR SELECT TO authenticated
  USING (status IN ('open','matched','in_progress','done'));
CREATE POLICY jobs_update_assigned_helper ON public.jobs FOR UPDATE TO authenticated
  USING (assigned_helper_id IN (SELECT id FROM public.helper_profiles WHERE user_id = auth.uid()))
  WITH CHECK (assigned_helper_id IN (SELECT id FROM public.helper_profiles WHERE user_id = auth.uid()));
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- offers
CREATE TABLE public.job_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid NOT NULL REFERENCES public.helper_profiles(id) ON DELETE CASCADE,
  helper_user_id uuid NOT NULL,
  message text,
  price numeric,
  match_score numeric,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, helper_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_offers TO authenticated;
GRANT ALL ON public.job_offers TO service_role;
ALTER TABLE public.job_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_offers_helper_own ON public.job_offers FOR ALL TO authenticated
  USING (helper_user_id = auth.uid()) WITH CHECK (helper_user_id = auth.uid());
CREATE POLICY job_offers_job_owner_read ON public.job_offers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_offers.job_id AND j.user_id = auth.uid()));
CREATE POLICY job_offers_job_owner_update ON public.job_offers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_offers.job_id AND j.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_offers.job_id AND j.user_id = auth.uid()));
CREATE TRIGGER trg_job_offers_updated BEFORE UPDATE ON public.job_offers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- reviews
CREATE TABLE public.job_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  helper_id uuid NOT NULL REFERENCES public.helper_profiles(id) ON DELETE CASCADE,
  rating integer NOT NULL DEFAULT 5,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, reviewer_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_reviews TO authenticated;
GRANT ALL ON public.job_reviews TO service_role;
ALTER TABLE public.job_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_reviews_read ON public.job_reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY job_reviews_own ON public.job_reviews FOR ALL TO authenticated
  USING (reviewer_id = auth.uid()) WITH CHECK (reviewer_id = auth.uid());

-- platform settings (singleton)
CREATE TABLE public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  revenue_mode text NOT NULL DEFAULT 'commission',
  commission_rate numeric NOT NULL DEFAULT 5,
  service_fee numeric NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_settings_read ON public.platform_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY platform_settings_admin_write ON public.platform_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_platform_settings_updated BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.platform_settings (id) VALUES (true);