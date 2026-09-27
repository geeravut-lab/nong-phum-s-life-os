-- Automation rules: the "when X, do Y" the tick already performs, moved out of
-- the code so the numbers can be changed without a deploy.
--
-- What this is NOT: a generic condition builder. Storing arbitrary queries in
-- jsonb would be a query language in a column - powerful, impossible to test,
-- and a way to take the site down from an admin form. Each rule keeps its
-- condition in typed code where it can be read and tested; what moves into the
-- database is the part that actually gets tuned: whether it runs at all, and
-- the numbers in it ("3 days", "80%", "48 hours").
--
-- Every rule that the tick already performed is seeded here with the value it
-- was hardcoded with, so applying this migration changes no behaviour.

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Matches a handler in cron.server.ts. Unknown keys are ignored by the tick. */
  key text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  /** The rule's numbers, e.g. {"days": 3}. Shape is per rule, documented in code. */
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Ordering in the admin list; also the order the tick runs them in. */
  sort_order integer NOT NULL DEFAULT 100,
  last_run_at timestamptz,
  /** What the last run did - rows notified, rows deleted - so a rule that has
      quietly stopped working is visible without reading logs. */
  last_count integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_rules_admin_read ON public.automation_rules;
CREATE POLICY automation_rules_admin_read ON public.automation_rules
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.automation_rules TO authenticated;
GRANT ALL ON public.automation_rules TO service_role;

-- Suspension for unpaid pay-as-you-go. The pricing text has always promised
-- this ("ชำระภายใน grace days มิฉะนั้นระบบจะระงับ AI") and nothing enforced it.
-- A flag the quota check reads, never a deletion of anything.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_suspended boolean NOT NULL DEFAULT false;

-- A monthly spending ceiling, so "over 80% of budget" has something to be 80% of.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS monthly_budget numeric;

COMMENT ON COLUMN public.profiles.monthly_budget IS
  'Optional ceiling for this month''s spending, in baht. Null means no warning.';

-- Seeds. ON CONFLICT DO NOTHING so an admin's later edits are never overwritten
-- by a redeploy - the seed is the starting value, not the enforced value.
INSERT INTO public.automation_rules (key, title, description, params, sort_order) VALUES
  ('reminders_rolled_over', 'ยกงานที่เลยกำหนดมาวันนี้',
   'งานที่เลยกำหนดเกินจำนวนวันที่ตั้งไว้ จะถูกยกมาเป็นวันปัจจุบัน', '{"days": 28}', 10),
  ('reminders_notified', 'เตือนเมื่อถึงกำหนด',
   'แจ้งเตือนงานและนัดที่ถึงกำหนดในรอบนี้', '{}', 20),
  ('digest_lookahead_claimed', 'สรุปประจำวันทาง LINE',
   'รวมงานของวันถัดไปเป็นข้อความเดียว ส่งตามเวลาที่ตั้งใน notification_settings', '{}', 30),
  ('routine_changes_alerted', 'กิจวัตรขาดช่วง',
   'แจ้งครอบครัวเมื่อไม่มีการบันทึกกิจวัตรเกินรอบ + วันผ่อนผันของกิจวัตรนั้น', '{}', 40),
  ('line_sent', 'ส่งคิว LINE',
   'ส่งข้อความที่รออยู่ในคิว ภายใต้เพดานรายเดือน', '{}', 50),
  ('ai_events_deleted', 'ลบ log ของ AI',
   'ลบบันทึก fallback/error ของ AI ที่เก่ากว่าที่กำหนด', '{"days": 30}', 200),
  ('failed_docs_deleted', 'ลบเอกสารที่อ่านไม่สำเร็จ',
   'ลบเอกสารสถานะ failed ที่เก่ากว่าที่กำหนด', '{"days": 30}', 210),
  ('pending_docs_deleted', 'ลบเอกสารค้างอัปโหลด',
   'ลบเอกสารสถานะ pending ที่ค้างเกินจำนวนชั่วโมงที่กำหนด', '{"hours": 1}', 220),
  ('notification_log_deleted', 'ลบ log การแจ้งเตือน',
   'ต้องครอบคลุมอย่างน้อย 2 รอบบิลของ LINE เพื่อให้นับโควต้าได้ถูก', '{"days": 90}', 230),
  ('cron_ticks_deleted', 'ลบ log การรันอัตโนมัติ', '', '{"days": 30}', 240),
  ('orphan_attachments_deleted', 'ลบไฟล์แนบกำพร้า',
   'ไฟล์ที่ไม่มีแถวข้อมูลชี้ถึงแล้ว', '{}', 250),
  ('escrow_auto_cancelled', 'ยกเลิก escrow ที่ค้าง', '', '{}', 260),
  ('expire_pending_offers', 'หมดอายุข้อเสนอที่ค้าง', '', '{}', 270),
  ('line_states_deleted', 'ลบสถานะเชื่อม LINE ที่หมดอายุ', '', '{}', 280),

  -- New rules.
  ('checkin_missing', 'ไม่มีเช็คอินหลายวัน',
   'ไม่มีเช็คอินเกินจำนวนวันที่ตั้งไว้ → แจ้งสมาชิกครอบครัวคนอื่น', '{"days": 3}', 60),
  ('routine_overdue_escalate', 'กิจวัตรค้างนานผิดปกติ',
   'ค้างเกินกี่เท่าของรอบปกติ → แจ้งทันทีไม่ต้องรอวันผ่อนผัน', '{"multiplier": 2}', 70),
  ('insurance_expiring', 'ประกัน/เอกสารใกล้หมดอายุ',
   'เอกสารที่มีวันหมดอายุภายในกี่วัน → แจ้งเตือนและสร้างงานให้อัตโนมัติ', '{"days": 30}', 80),
  ('warranty_expiring', 'ประกันสินค้าใกล้หมด',
   'ใบรับประกันที่จะหมดภายในกี่วัน → แจ้งเตือน', '{"days": 30}', 90),
  ('premium_expiring', 'แพ็กใกล้หมดอายุ',
   'Premium/Family ที่จะหมดภายในกี่วัน → เตือนให้ต่ออายุ', '{"days": 7}', 100),
  ('payg_overdue_suspend', 'PAYG ค้างชำระเกินกำหนด',
   'ค้างเกิน payg_grace_days → ระงับการใช้ AI จนกว่าจะชำระ', '{}', 110),
  ('funeral_review_stale', 'แผนงานศพรอยืนยันนาน',
   'อยู่สถานะรอยืนยันเกินกี่ชั่วโมง → เตือนผู้ดูแลระบบซ้ำ', '{"hours": 48}', 120),
  ('job_no_offers', 'งานยังไม่มีข้อเสนอ',
   'โพสต์เกินกี่ชั่วโมงแล้วยังไม่มีข้อเสนอ → แจ้งผู้รับงานที่ match score ถึงเกณฑ์',
   '{"hours": 24, "minScore": 70}', 130),
  ('budget_over_percent', 'ใช้จ่ายเกินงบที่ตั้งไว้',
   'รายจ่ายเดือนนี้ถึงกี่ % ของงบที่ผู้ใช้ตั้งไว้ → เตือน', '{"percent": 80}', 140)
ON CONFLICT (key) DO NOTHING;
