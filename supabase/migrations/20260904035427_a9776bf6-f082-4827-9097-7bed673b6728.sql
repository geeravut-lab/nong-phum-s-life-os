CREATE TABLE public.benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  title_en text,
  provider text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other',
  summary text NOT NULL DEFAULT '',
  how_to text NOT NULL DEFAULT '',
  link text,
  est_value numeric,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.benefits TO authenticated;
GRANT ALL ON public.benefits TO service_role;
ALTER TABLE public.benefits ENABLE ROW LEVEL SECURITY;
CREATE POLICY benefits_read ON public.benefits FOR SELECT TO authenticated USING (is_active);
CREATE POLICY benefits_admin_write ON public.benefits FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.benefit_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  birth_year integer,
  monthly_income numeric,
  occupation text,
  province text,
  household_size integer,
  groups text[] NOT NULL DEFAULT '{}'::text[],
  has_social_security boolean NOT NULL DEFAULT false,
  has_welfare_card boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.benefit_profiles TO authenticated;
GRANT ALL ON public.benefit_profiles TO service_role;
ALTER TABLE public.benefit_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY benefit_profiles_own ON public.benefit_profiles FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.user_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  benefit_id uuid NOT NULL REFERENCES public.benefits(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'interested',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, benefit_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_benefits TO authenticated;
GRANT ALL ON public.user_benefits TO service_role;
ALTER TABLE public.user_benefits ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_benefits_own ON public.user_benefits FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER benefits_updated_at BEFORE UPDATE ON public.benefits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER benefit_profiles_updated_at BEFORE UPDATE ON public.benefit_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER user_benefits_updated_at BEFORE UPDATE ON public.user_benefits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.benefits (slug, title, title_en, provider, category, summary, how_to, link, est_value, eligibility) VALUES
('old-age-allowance','เบี้ยยังชีพผู้สูงอายุ','Old Age Allowance','กรมกิจการผู้สูงอายุ / อปท.','elderly','เงินช่วยเหลือรายเดือนแบบขั้นบันได 600-1,000 บาท สำหรับผู้มีอายุ 60 ปีขึ้นไป','ลงทะเบียนที่เทศบาล/อบต. ตามทะเบียนบ้าน พร้อมบัตรประชาชนและสมุดบัญชีธนาคาร','https://www.dop.go.th', 700, '{"min_age":60}'::jsonb),
('disability-allowance','เบี้ยความพิการ','Disability Allowance','กรมส่งเสริมและพัฒนาคุณภาพชีวิตคนพิการ','disability','เงินช่วยเหลือรายเดือน 800-1,000 บาท สำหรับผู้มีบัตรประจำตัวคนพิการ','ทำบัตรประจำตัวคนพิการ แล้วลงทะเบียนรับเบี้ยที่ อปท. ตามทะเบียนบ้าน','https://dep.go.th', 800, '{"groups":["disabled"]}'::jsonb),
('welfare-card','บัตรสวัสดิการแห่งรัฐ','State Welfare Card','กระทรวงการคลัง','income','วงเงินค่าซื้อสินค้าอุปโภคบริโภค ค่าเดินทาง และส่วนลดค่าน้ำค่าไฟ สำหรับผู้มีรายได้น้อย','ลงทะเบียนตามรอบที่รัฐเปิด ที่ธนาคารรัฐหรือหน่วยรับลงทะเบียน','https://welfare.mof.go.th', 300, '{"max_annual_income":100000,"min_age":18}'::jsonb),
('child-support-grant','เงินอุดหนุนเพื่อการเลี้ยงดูเด็กแรกเกิด','Child Support Grant','กรมกิจการเด็กและเยาวชน','family','เดือนละ 600 บาทต่อเด็กหนึ่งคน ตั้งแต่แรกเกิดถึง 6 ปี ในครัวเรือนรายได้น้อย','ยื่นที่ อปท. พร้อมสูติบัตร บัตรประชาชน และแบบรับรองสถานะครัวเรือน','https://csg.dcy.go.th', 600, '{"groups":["parent"],"max_annual_income":100000}'::jsonb),
('sso-m33','ประกันสังคม มาตรา 33','Social Security Section 33','สำนักงานประกันสังคม','health','สิทธิรักษาพยาบาล ว่างงาน คลอดบุตร ทุพพลภาพ ชราภาพ สำหรับลูกจ้างในสถานประกอบการ','นายจ้างขึ้นทะเบียนให้ ตรวจสอบสิทธิผ่านแอป SSO Connect','https://www.sso.go.th', NULL, '{"requires_social_security":true}'::jsonb),
('sso-m40','ประกันสังคม มาตรา 40','Social Security Section 40','สำนักงานประกันสังคม','health','สำหรับผู้ประกอบอาชีพอิสระ จ่ายเริ่มต้น 70 บาท/เดือน ได้เงินทดแทนขาดรายได้และเงินบำเหน็จชราภาพ','สมัครที่สำนักงานประกันสังคม เซเว่นอีเลฟเว่น หรือแอป SSO Connect','https://www.sso.go.th', NULL, '{"groups":["freelance","farmer"],"requires_no_social_security":true}'::jsonb),
('uc-gold-card','สิทธิบัตรทอง 30 บาท (UCEP รวม)','Universal Coverage Scheme','สปสช.','health','รักษาฟรีตามสิทธิหลักประกันสุขภาพแห่งชาติ รวมถึงเจ็บป่วยฉุกเฉินวิกฤต','ตรวจสอบและย้ายหน่วยบริการผ่านแอป สปสช. หรือสายด่วน 1330','https://www.nhso.go.th', NULL, '{"requires_no_social_security":true}'::jsonb),
('tax-deduction','ลดหย่อนภาษีเงินได้บุคคลธรรมดา','Personal Income Tax Deductions','กรมสรรพากร','tax','สิทธิลดหย่อนส่วนตัว คู่สมรส บุตร บิดามารดา ประกัน กองทุน และดอกเบี้ยบ้าน','ยื่นแบบ ภ.ง.ด.90/91 ออนไลน์ผ่าน E-Filing ช่วง ม.ค.-มี.ค.','https://efiling.rd.go.th', NULL, '{"min_age":18}'::jsonb),
('student-loan','กองทุนเงินให้กู้ยืมเพื่อการศึกษา (กยศ.)','Student Loan Fund','กยศ.','education','กู้ยืมค่าเล่าเรียนและค่าครองชีพ ดอกเบี้ยต่ำ ผ่อนชำระหลังจบการศึกษา','ยื่นผ่านแอป กยศ. Connect ตามรอบของสถานศึกษา','https://www.studentloan.or.th', NULL, '{"groups":["student"],"max_age":30}'::jsonb),
('farmer-support','ทะเบียนเกษตรกรและมาตรการช่วยเหลือ','Farmer Registration Support','กรมส่งเสริมการเกษตร','agriculture','สิทธิเข้าถึงเงินช่วยเหลือ ประกันภัยพืชผล และสินเชื่อ ธ.ก.ส.','ขึ้นทะเบียน/ปรับปรุงทะเบียนเกษตรกรที่สำนักงานเกษตรอำเภอทุกปี','https://www.doae.go.th', NULL, '{"groups":["farmer"]}'::jsonb),
('unemployment-benefit','เงินทดแทนกรณีว่างงาน','Unemployment Benefit','สำนักงานประกันสังคม','work','รับเงินทดแทน 30-50% ของค่าจ้าง สูงสุด 180 วัน เมื่อว่างงานและเคยส่งเงินสมทบครบเกณฑ์','ขึ้นทะเบียนว่างงานที่เว็บกรมการจัดหางานภายใน 30 วัน และรายงานตัวทุกเดือน','https://e-service.doe.go.th', NULL, '{"requires_social_security":true,"groups":["unemployed"]}'::jsonb),
('housing-loan','สินเชื่อบ้านผู้มีรายได้น้อย ธอส.','Low-income Housing Loan','ธนาคารอาคารสงเคราะห์','housing','สินเชื่อบ้านอัตราดอกเบี้ยพิเศษสำหรับผู้มีรายได้น้อยถึงปานกลาง','ยื่นขอสินเชื่อที่สาขา ธอส. พร้อมเอกสารรายได้และเอกสารหลักประกัน','https://www.ghbank.co.th', NULL, '{"max_annual_income":600000,"min_age":20}'::jsonb);