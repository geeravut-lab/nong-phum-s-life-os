-- Post-Life Action Plan: checklist after death_cases becomes confirmed

CREATE TABLE IF NOT EXISTS public.post_life_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.death_cases(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('24h', '3d', 'later')),
  sort_order int NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped')),
  done_at timestamptz,
  done_by uuid,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_life_actions_case_idx
  ON public.post_life_actions (case_id, phase, sort_order);

CREATE INDEX IF NOT EXISTS post_life_actions_subject_idx
  ON public.post_life_actions (subject_user_id);

GRANT SELECT, INSERT, UPDATE ON public.post_life_actions TO authenticated;
GRANT ALL ON public.post_life_actions TO service_role;

ALTER TABLE public.post_life_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_life_actions_select ON public.post_life_actions
  FOR SELECT TO authenticated
  USING (
    subject_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.death_cases d
      WHERE d.id = post_life_actions.case_id
        AND (d.reported_by = auth.uid() OR d.subject_user_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.legacy_contacts c
      WHERE c.user_id = post_life_actions.subject_user_id
        AND c.is_verifier = true
        AND c.linked_user_id = auth.uid()
        AND c.invite_status = 'accepted'
    )
  );

CREATE POLICY post_life_actions_update ON public.post_life_actions
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.legacy_contacts c
      WHERE c.user_id = post_life_actions.subject_user_id
        AND c.is_verifier = true
        AND c.linked_user_id = auth.uid()
        AND c.invite_status = 'accepted'
    )
    OR EXISTS (
      SELECT 1 FROM public.death_cases d
      WHERE d.id = post_life_actions.case_id AND d.reported_by = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.seed_post_life_actions(p_case_id uuid, p_subject uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.post_life_actions WHERE case_id = p_case_id LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO public.post_life_actions (case_id, subject_user_id, phase, sort_order, title, description) VALUES
    (p_case_id, p_subject, '24h', 1, 'แจ้งบุคคลที่กำหนด', 'ติดต่อคนที่ไว้ใจตามลำดับความสำคัญในแผนฝากไว้'),
    (p_case_id, p_subject, '24h', 2, 'เปิด Memorial', 'ตรวจสอบ/แชร์หน้าอาลัยบุ๊คให้ครอบครัว'),
    (p_case_id, p_subject, '24h', 3, 'แจ้งข้อมูลที่ได้รับอนุญาต', 'ส่งเฉพาะข้อมูลที่เจ้าของแผนอนุญาต — ไม่เปิดเผยเกินความจำเป็น');

  INSERT INTO public.post_life_actions (case_id, subject_user_id, phase, sort_order, title, description) VALUES
    (p_case_id, p_subject, '3d', 1, 'เอกสารสำคัญ', 'รวบรวมบัตรประชาชน สำเนา และเอกสารที่อ้างในแผน'),
    (p_case_id, p_subject, '3d', 2, 'สถานที่และพิธี', 'ยืนยันสถานที่จัดพิธีตามความต้องการงานศพ'),
    (p_case_id, p_subject, '3d', 3, 'ผู้ให้บริการ', 'ติดต่อวัด/สถานที่/ผู้ให้บริการที่เกี่ยวข้อง'),
    (p_case_id, p_subject, '3d', 4, 'แผนงานศพ (ถ้ามี)', 'ดูแพ็กเกจจาก AI Funeral Planner และสถานะการชำระ');

  INSERT INTO public.post_life_actions (case_id, subject_user_id, phase, sort_order, title, description) VALUES
    (p_case_id, p_subject, 'later', 1, 'ทรัพย์สิน', 'เปิดดูรายการทรัพย์สินในแผนฝากไว้ (ไม่ใช่เอกสารทางกฎหมาย)'),
    (p_case_id, p_subject, 'later', 2, 'หนี้สิน / ภาระ', 'ตรวจสอบรายการหนี้และภาระที่บันทึกไว้'),
    (p_case_id, p_subject, 'later', 3, 'ประกันและสิทธิ', 'ติดต่อบริษัทประกัน / สิทธิที่เกี่ยวข้อง'),
    (p_case_id, p_subject, 'later', 4, 'บัญชีและดิจิทัล', 'จัดการบัญชีธนาคาร / ดิจิทัลตามที่ระบุในแผน'),
    (p_case_id, p_subject, 'later', 5, 'มรดก / พินัยกรรม (อ้างอิง)', 'ติดตามที่เก็บพินัยกรรมตามที่เจ้าของแผนระบุ — ดำเนินการตามกฎหมายภายนอกแอป');
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_death_confirm_seed_actions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND (OLD.status IS DISTINCT FROM 'confirmed') THEN
    PERFORM public.seed_post_life_actions(NEW.id, NEW.subject_user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_death_confirm_seed_actions ON public.death_cases;
CREATE TRIGGER trg_death_confirm_seed_actions
  AFTER UPDATE OF status ON public.death_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_death_confirm_seed_actions();
