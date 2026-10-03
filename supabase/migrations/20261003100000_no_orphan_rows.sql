-- Two cleanup rules, and the rows the old funeral flow left behind.
--
-- 1. app_notifications was never pruned. The inbox shows the newest 200, so
--    nobody noticed, but the table grows for ever. Rows the user has READ are
--    removed after their retention; unread rows are left alone however old,
--    because the user has not seen them yet.
--
-- 2. funeral_plans in 'draft' are three generated packages nobody chose.
--    planFuneral now keeps at most one draft per user and refuses to write a
--    second plan while one is live, so this rule only catches what earlier
--    versions left and anything a failed select strands.

INSERT INTO public.automation_rules (key, title, description, params, sort_order) VALUES
  ('read_notifications_deleted', 'ลบการแจ้งเตือนที่อ่านแล้ว',
   'การแจ้งเตือนที่ผู้ใช้อ่านแล้วและเก่ากว่าจำนวนวันที่ตั้งไว้ จะถูกลบ · รายการที่ยังไม่อ่านไม่ถูกลบไม่ว่าจะเก่าแค่ไหน',
   '{"days": 90}', 60),
  ('funeral_drafts_deleted', 'ลบแผนงานศพที่สร้างแพ็กเกจแล้วไม่ได้เลือก',
   'แถวที่ยังเป็น draft (สร้างแพ็กเกจแล้วผู้ใช้ไม่ได้เลือก) และเก่ากว่าจำนวนวันที่ตั้งไว้ จะถูกลบ',
   '{"days": 7}', 61)
ON CONFLICT DO NOTHING;

-- The drafts already in the table. A draft holds no instalments, no evidence
-- and no money - it is a preview whose owner walked away - so there is nothing
-- to keep. Anything a user chose is status 'selected' or beyond and is NOT
-- touched here.
DELETE FROM public.funeral_plans
WHERE status = 'draft';
