-- ล้าง draft เก่า (หลังอัปเดตโค้ดใหม่จะไม่สร้าง draft อีก — insert เฉพาะตอนแจ้งโอน)
DELETE FROM public.premium_payments WHERE payment_status = 'draft';
