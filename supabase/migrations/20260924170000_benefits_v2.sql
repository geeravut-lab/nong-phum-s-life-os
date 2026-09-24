-- Phase 3 remaining: Benefits v2 — deadlines + source freshness + user deadline tracking

ALTER TABLE public.benefits
  ADD COLUMN IF NOT EXISTS deadline_month integer
    CHECK (deadline_month IS NULL OR (deadline_month BETWEEN 1 AND 12)),
  ADD COLUMN IF NOT EXISTS deadline_day integer
    CHECK (deadline_day IS NULL OR (deadline_day BETWEEN 1 AND 31)),
  ADD COLUMN IF NOT EXISTS deadline_note text,
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS verified_at date;

ALTER TABLE public.user_benefits
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS deadline_at date,
  ADD COLUMN IF NOT EXISTS remind boolean NOT NULL DEFAULT false;

-- Seed / update known annual windows (best-effort public knowledge)
UPDATE public.benefits SET
  deadline_month = 3, deadline_day = 31,
  deadline_note = 'ยื่นแบบ ภ.ง.ด.90/91 โดยทั่วไปภายในสิ้นมีนาคมของปีถัดไป',
  source_name = 'กรมสรรพากร',
  verified_at = CURRENT_DATE
WHERE slug = 'tax-deduction';

UPDATE public.benefits SET
  deadline_note = 'ขึ้นทะเบียนว่างงานภายใน 30 วันหลังออกจากงาน',
  source_name = 'กรมการจัดหางาน / ประกันสังคม',
  verified_at = CURRENT_DATE
WHERE slug = 'unemployment-benefit';

UPDATE public.benefits SET
  deadline_note = 'ตามรอบเปิดรับของสถานศึกษา (มักต้นภาคเรียน)',
  source_name = 'กยศ.',
  verified_at = CURRENT_DATE
WHERE slug = 'student-loan';

UPDATE public.benefits SET
  deadline_note = 'ปรับปรุงทะเบียนเกษตรกรประจำปีที่สำนักงานเกษตรอำเภอ',
  source_name = 'กรมส่งเสริมการเกษตร',
  verified_at = CURRENT_DATE
WHERE slug = 'farmer-support';

UPDATE public.benefits SET
  source_name = COALESCE(source_name, provider),
  verified_at = COALESCE(verified_at, CURRENT_DATE)
WHERE is_active = true AND verified_at IS NULL;
