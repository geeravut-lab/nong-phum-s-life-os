-- เวลาของรายการรายรับ-รายจ่าย ไม่ใช่แค่วัน
--
-- เดิมเก็บแค่ spent_on / received_on ซึ่งเป็น date ผู้ใช้บอกในแชทว่า
-- "กินข้าวไป 80 ตอนห้าโมงสิบห้า" ระบบก็บันทึกได้แค่วัน เวลาหายไป
--
-- เพิ่มคอลัมน์ใหม่แทนที่จะเปลี่ยนชนิดของคอลัมน์เดิม เพราะ spent_on ถูกใช้
-- จัดกลุ่มและรวมยอดรายเดือนอยู่หลายที่ (งบประมาณ สรุปหน้าวันนี้ รายงาน)
-- การเปลี่ยนเป็น timestamptz จะทำให้ทุกจุดนั้นต้องแก้ตาม
--
-- ยอมให้เป็น null ได้ เพราะแถวเก่าไม่มีเวลาให้เดา — การ์ดจะแสดงเฉพาะวัน
-- สำหรับแถวเหล่านั้น ดีกว่าเติม 00:00 ที่ไม่เคยเกิดขึ้นจริง
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS spent_at timestamptz;

ALTER TABLE public.incomes
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

COMMENT ON COLUMN public.expenses.spent_at IS
  'เวลาที่ใช้จ่ายจริง (timestamptz) · null = แถวเก่าที่รู้แค่วัน · spent_on ยังเป็นตัวหลักในการรวมยอดรายเดือน';
COMMENT ON COLUMN public.incomes.received_at IS
  'เวลาที่รับเงินจริง (timestamptz) · null = แถวเก่าที่รู้แค่วัน · received_on ยังเป็นตัวหลักในการรวมยอดรายเดือน';
