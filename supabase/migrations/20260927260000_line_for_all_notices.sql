-- ส่งการแจ้งเตือนทุกชนิดเข้า LINE ได้ และเลิกทิ้งการแจ้งเตือนเงียบ ๆ
--
-- สองเรื่องที่ต้องแก้พร้อมกัน เพราะเรื่องที่สองทำให้เรื่องแรกไม่มีความหมาย
--
-- 1) app_notifications.kind มี CHECK จำกัดไว้ 8 ค่าตั้งแต่ตอนสร้างตาราง แต่โค้ด
--    เขียนชนิดที่เพิ่มมาทีหลังอีกหลายสิบ ('family_task', 'funeral_review',
--    'budget_warning' ฯลฯ) ทุกแถวเหล่านั้นถูกฐานข้อมูลปฏิเสธ และผู้เรียกไม่ได้
--    ตรวจ error จึงเงียบสนิท — ทดสอบบน production แล้ว: มอบหมายงานครอบครัวให้
--    อีกคน แล้วหน้าการแจ้งเตือนของเขาว่างเปล่า
--
--    ชนิดของการแจ้งเตือนเป็นชุดเปิดที่โตตามฟีเจอร์ การมี CHECK ที่ต้องตามแก้ทุกครั้ง
--    แล้วถ้าลืมก็ทิ้งข้อมูลเงียบ ๆ แย่กว่าไม่มี CHECK จึงถอดออก เหลือแค่ห้ามว่าง
--
-- 2) notification_log เดิมรับแค่ 'immediate' กับ 'digest' ซึ่งเป็นเรื่องของ
--    reminders อย่างเดียว เพิ่มชนิด 'app' ที่พกข้อความมาเองในแถว ไม่ต้อง join
--    กลับไปหา app_notifications — แถวคิวส่งจึงอยู่รอดได้แม้การแจ้งเตือนต้นทาง
--    จะถูกล้างตามนโยบายเก็บข้อมูล

-- ---------------------------------------------------------------------------
-- 1. เลิกจำกัดชนิดของการแจ้งเตือนในแอป
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_kind_check;

ALTER TABLE public.app_notifications
  ADD CONSTRAINT app_notifications_kind_not_blank CHECK (length(btrim(kind)) > 0);

-- ---------------------------------------------------------------------------
-- 2. คิวส่ง LINE รับการแจ้งเตือนทั่วไปได้
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS href text,
  -- อ้างถึงแถวต้นทางเพื่อการตรวจสอบย้อนหลัง ไม่มี FK ตามแบบเดิมของตารางนี้:
  -- แถวคิวส่งต้องอยู่ได้แม้ต้นทางจะหายไปแล้ว
  ADD COLUMN IF NOT EXISTS app_notification_id uuid;

ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_kind_check;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_kind_check
  CHECK (kind IN ('immediate', 'digest', 'app'));

ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_kind_shape;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_kind_shape CHECK (
    (kind = 'immediate' AND reminder_id IS NOT NULL AND due_at IS NOT NULL AND digest_date IS NULL)
    OR
    (kind = 'digest' AND reminder_id IS NULL AND due_at IS NULL AND digest_date IS NOT NULL)
    OR
    -- 'app' พกข้อความมาเอง ไม่ยุ่งกับคอลัมน์ของ reminders เลย
    (kind = 'app' AND reminder_id IS NULL AND due_at IS NULL AND digest_date IS NULL
     AND app_notification_id IS NOT NULL AND length(btrim(coalesce(title, ''))) > 0)
  );

-- กันส่งซ้ำแบบเดียวกับ immediate: การแจ้งเตือนหนึ่งแถว เข้าคิว LINE ได้ครั้งเดียว
CREATE UNIQUE INDEX IF NOT EXISTS notification_log_app_once
  ON public.notification_log (app_notification_id)
  WHERE kind = 'app';

CREATE INDEX IF NOT EXISTS notification_log_queued_idx
  ON public.notification_log (channel, status, created_at)
  WHERE status = 'queued';
