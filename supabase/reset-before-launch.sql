-- ============================================================================
-- ล้างข้อมูลทดสอบก่อนเปิดใช้จริง (Life OS)
--
-- ⚠️  สคริปต์นี้ลบข้อมูลถาวร ย้อนกลับไม่ได้ ⚠️
--
-- วิธีใช้:
--   1) สำรองฐานข้อมูลก่อน (Supabase → Database → Backups → ดาวน์โหลด หรือ
--      pg_dump) ทำก่อนเสมอ ไม่ว่าจะมั่นใจแค่ไหน
--   2) แก้รายชื่ออีเมลใน KEEP_EMAILS ด้านล่างให้เป็นบัญชีที่ต้องการเก็บไว้
--   3) รันส่วน "ขั้นที่ 0" ก่อน เพื่อดูว่าจะลบใครบ้าง — ยังไม่ลบอะไร
--   4) พอใจแล้วค่อยรันส่วน "ขั้นที่ 1-4"
--   5) ล้างไฟล์ใน Storage แยกต่างหาก (ดู docs/GO-LIVE-CHECKLIST.md) เพราะ SQL
--      ลบแถวใน storage.objects ได้ แต่ไฟล์จริงจะค้างอยู่ในถัง
--
-- หลักการ: ลบ "ข้อมูลของคน" เก็บ "ข้อมูลตั้งค่าและข้อมูลอ้างอิง"
--   เก็บไว้ → benefits (แคตตาล็อกสิทธิรัฐ) · automation_rules (23 กฎ) ·
--             platform_settings (ราคา สวิตช์ ลิงก์คู่มือ) · ai_settings ·
--             donation_settings · notification_settings ·
--             local_places ที่ is_demo = true (ข้อมูลตัวอย่างจาก migration)
--   ลบ     → ทุกอย่างที่ผูกกับ auth.users
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ขั้นที่ 0 — ดูก่อนว่าจะลบใคร (อ่านอย่างเดียว ปลอดภัย)
-- ---------------------------------------------------------------------------
WITH keep AS (
  SELECT unnest(ARRAY[
    -- 👇 แก้ตรงนี้ ใส่อีเมลที่ต้องการเก็บไว้ (บัญชีแอดมินของคุณ)
    'owner@example.com'
  ]) AS email
)
SELECT
  count(*) FILTER (WHERE u.email IN (SELECT email FROM keep)) AS "จะเก็บไว้",
  count(*) FILTER (WHERE u.email NOT IN (SELECT email FROM keep)) AS "จะถูกลบ",
  count(*) AS "ทั้งหมด"
FROM auth.users u;

-- รายชื่อที่จะถูกลบ
WITH keep AS (
  SELECT unnest(ARRAY['owner@example.com']) AS email
)
SELECT u.email, u.created_at
FROM auth.users u
WHERE u.email NOT IN (SELECT email FROM keep)
ORDER BY u.created_at;

-- ---------------------------------------------------------------------------
-- ขั้นที่ 1 — ลบผู้ใช้ทดสอบ
--
-- ตารางส่วนใหญ่มี FK ไปยัง auth.users แบบ ON DELETE CASCADE อยู่แล้ว
-- (migration 20260927110000_pdpa_user_fks.sql) ข้อมูลของแต่ละคนจึงหายตามไปเอง:
-- เอกสาร งาน รายรับ-รายจ่าย ครอบครัว แผนมรดก ร้านค้า แผนเที่ยว ฯลฯ
-- ---------------------------------------------------------------------------
BEGIN;

DELETE FROM auth.users
WHERE email NOT IN (
  -- 👇 ต้องตรงกับรายชื่อในขั้นที่ 0
  'owner@example.com'
);

-- ---------------------------------------------------------------------------
-- ขั้นที่ 2 — ล้างตารางที่ "ตั้งใจให้รอด" ตอนลบผู้ใช้
--
-- ตารางเหล่านี้ใช้ ON DELETE SET NULL ไม่ใช่ CASCADE เพราะเป็นบัญชีแยกและ
-- ร่องรอยการตรวจสอบ — ลบผู้ใช้แล้วแถวยังอยู่แบบไม่มีชื่อ ซึ่งถูกต้องสำหรับ
-- ระบบที่เปิดใช้จริง แต่ก่อนเปิดใช้เราไม่ต้องการร่องรอยของการทดสอบ
-- ---------------------------------------------------------------------------
TRUNCATE TABLE
  public.account_deletions,
  public.privacy_audit_log,
  public.donations,
  public.premium_payments;

-- ---------------------------------------------------------------------------
-- ขั้นที่ 3 — รีเซ็ตตัวนับและ log ที่ไม่ได้ผูกกับผู้ใช้
-- ---------------------------------------------------------------------------
TRUNCATE TABLE
  public.usage_daily,        -- สถิติเปิดหน้า (/admin/usage)
  public.ai_token_usage,     -- token และต้นทุน AI จริง
  public.ai_usage_monthly,   -- โควต้ารายเดือน
  public.ai_events,
  public.notification_log,   -- กันส่งซ้ำของ tick
  public.cron_ticks;         -- ล็อกและ log ของ scheduled function

-- กฎอัตโนมัติ: เก็บตัวกฎและค่าพารามิเตอร์ไว้ ล้างแค่ผลการรันของรอบทดสอบ
UPDATE public.automation_rules
SET last_run_at = NULL, last_count = NULL, updated_by = NULL;

-- ---------------------------------------------------------------------------
-- ขั้นที่ 4 — ข้อมูล "ของดีใกล้บ้าน" ที่เหลือ
--
-- ร้านที่ผู้ใช้ทดสอบสร้างจะหายไปกับเจ้าของแล้ว (CASCADE) เหลือเฉพาะแถวตัวอย่าง
-- จาก migration ซึ่งตั้ง is_active = false, is_demo = true ไว้อยู่แล้ว
-- ถ้าไม่ต้องการแม้แต่แถวตัวอย่าง ให้เอา comment ออก
-- ---------------------------------------------------------------------------
-- DELETE FROM public.local_places WHERE is_demo = true;

-- ตรวจก่อน COMMIT: ทุกบรรทัดควรเป็น 0 ยกเว้นบัญชีที่ตั้งใจเก็บไว้
SELECT 'auth.users'      AS t, count(*) FROM auth.users
UNION ALL SELECT 'documents',      count(*) FROM public.documents
UNION ALL SELECT 'expenses',       count(*) FROM public.expenses
UNION ALL SELECT 'reminders',      count(*) FROM public.reminders
UNION ALL SELECT 'families',       count(*) FROM public.families
UNION ALL SELECT 'jobs',           count(*) FROM public.jobs
UNION ALL SELECT 'legacy_profiles',count(*) FROM public.legacy_profiles
UNION ALL SELECT 'trip_plans',     count(*) FROM public.trip_plans
UNION ALL SELECT 'chat_messages',  count(*) FROM public.chat_messages
UNION ALL SELECT 'local_places (ไม่ใช่ demo)', count(*)
  FROM public.local_places WHERE is_demo IS DISTINCT FROM true
UNION ALL SELECT '-- เก็บไว้: benefits',        count(*) FROM public.benefits
UNION ALL SELECT '-- เก็บไว้: automation_rules', count(*) FROM public.automation_rules;

-- ถ้าผลลัพธ์ถูกต้อง:
COMMIT;
-- ถ้าไม่ถูก:
-- ROLLBACK;
