-- Phase 5 — Life Legacy (A): data entered while the user is alive
-- Legal note: this is NOT a formal will under Thai law — store references only.

CREATE TABLE IF NOT EXISTS public.legacy_profiles (
  user_id uuid PRIMARY KEY,
  consent_at timestamptz,
  notes text NOT NULL DEFAULT '',
  organ_donation text NOT NULL DEFAULT 'undecided'
    CHECK (organ_donation IN ('yes','no','undecided')),
  body_donation text NOT NULL DEFAULT 'undecided'
    CHECK (body_donation IN ('yes','no','undecided')),
  social_intent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_profiles TO authenticated;
GRANT ALL ON public.legacy_profiles TO service_role;
ALTER TABLE public.legacy_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_profiles_own ON public.legacy_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_legacy_profiles_updated BEFORE UPDATE ON public.legacy_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trusted contacts (notify list / priority)
CREATE TABLE IF NOT EXISTS public.legacy_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  full_name text NOT NULL,
  relation text NOT NULL DEFAULT '',
  phone text,
  email text,
  line_id text,
  priority smallint NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 20),
  is_verifier boolean NOT NULL DEFAULT false,
  personal_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legacy_contacts_user_idx ON public.legacy_contacts (user_id, priority);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_contacts TO authenticated;
GRANT ALL ON public.legacy_contacts TO service_role;
ALTER TABLE public.legacy_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_contacts_own ON public.legacy_contacts
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_legacy_contacts_updated BEFORE UPDATE ON public.legacy_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Assets & liabilities inventory
CREATE TABLE IF NOT EXISTS public.legacy_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN (
      'bank','investment','stock','fund','insurance','sso','coop','property',
      'vehicle','business','gold','valuables','digital','debt','loan_guarantee',
      'credit_card','receivable','benefit','other'
    )),
  title text NOT NULL,
  details text NOT NULL DEFAULT '',
  estimated_value numeric,
  location_hint text,
  beneficiary_hint text,
  is_liability boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legacy_assets_user_idx ON public.legacy_assets (user_id, kind);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_assets TO authenticated;
GRANT ALL ON public.legacy_assets TO service_role;
ALTER TABLE public.legacy_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_assets_own ON public.legacy_assets
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_legacy_assets_updated BEFORE UPDATE ON public.legacy_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Final wishes + life story + messages (sectioned content)
CREATE TABLE IF NOT EXISTS public.legacy_wishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  section text NOT NULL DEFAULT 'final_wishes'
    CHECK (section IN (
      'final_wishes','funeral_pref','life_story','legacy_message','will_ref','vault_note'
    )),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legacy_wishes_user_section_idx ON public.legacy_wishes (user_id, section);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_wishes TO authenticated;
GRANT ALL ON public.legacy_wishes TO service_role;
ALTER TABLE public.legacy_wishes ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_wishes_own ON public.legacy_wishes
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_legacy_wishes_updated BEFORE UPDATE ON public.legacy_wishes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- After-life checklist (user-owned template)
CREATE TABLE IF NOT EXISTS public.legacy_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  assignee_hint text,
  is_done boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legacy_checklist_user_idx ON public.legacy_checklist (user_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_checklist TO authenticated;
GRANT ALL ON public.legacy_checklist TO service_role;
ALTER TABLE public.legacy_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_checklist_own ON public.legacy_checklist
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_legacy_checklist_updated BEFORE UPDATE ON public.legacy_checklist
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Default checklist seeds via function (called once from client)
CREATE OR REPLACE FUNCTION public.legacy_seed_checklist(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT COUNT(*) INTO n FROM public.legacy_checklist WHERE user_id = p_user_id;
  IF n > 0 THEN
    RETURN 0;
  END IF;
  INSERT INTO public.legacy_checklist (user_id, title, notes, sort_order) VALUES
    (p_user_id, 'แจ้งญาติสนิท / ผู้ติดต่อหลัก', 'ใช้รายชื่อใน Trusted Contacts', 1),
    (p_user_id, 'ติดต่อวัด / สถานที่จัดพิธี', 'ดู Final Wishes / Funeral pref', 2),
    (p_user_id, 'รวบรวมเอกสารสำคัญ', 'บัตรประชาชน สำเนาทะเบียนบ้าน พินัยกรรม (ถ้ามี)', 3),
    (p_user_id, 'แจ้งธนาคาร / ประกัน / นายจ้าง', 'ดูรายการ Assets & Insurance', 4),
    (p_user_id, 'จัดการบัญชีดิจิทัล', 'ดู Digital assets ใน Inventory', 5),
    (p_user_id, 'ยกเลิกบริการรายเดือนที่ไม่จำเป็น', '', 6),
    (p_user_id, 'ดูแลสัตว์เลี้ยง / พืชที่บ้าน', '', 7),
    (p_user_id, 'แจ้งที่ทำงาน / โรงเรียนของบุตร', '', 8);
  RETURN 8;
END;
$$;

GRANT EXECUTE ON FUNCTION public.legacy_seed_checklist(uuid) TO authenticated;
