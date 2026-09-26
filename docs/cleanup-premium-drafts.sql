-- ลบรายการที่ยังเป็น draft (สถานะ QR / ยังไม่แจ้งโอน)
SELECT id, user_id, plan_tier, amount, payment_status, created_at
FROM public.premium_payments
WHERE payment_status = 'draft'
ORDER BY created_at DESC;

DELETE FROM public.premium_payments
WHERE payment_status = 'draft';
