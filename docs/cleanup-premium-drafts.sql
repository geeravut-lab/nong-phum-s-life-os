-- ล้างรายการ Premium/Family ที่ค้างจากการกดสร้าง QR โดยยังไม่แจ้งโอน
-- ตรวจก่อน:
-- SELECT id, user_id, plan_tier, period, amount, payment_status, created_at FROM premium_payments ORDER BY created_at DESC LIMIT 50;

-- ลบเฉพาะที่ยังไม่ paid (ร่าง / รอตรวจจากการทดสอบ)
DELETE FROM public.premium_payments
WHERE payment_status IN ('pending', 'draft')
  AND (paid_at IS NULL);

-- ถ้าคอลัมน์ paid_at ไม่มี ใช้:
-- DELETE FROM public.premium_payments WHERE payment_status IN ('pending', 'draft');
