# Marketplace v2 — Quote & Offer, Chat+Evidence, Safety

## Quote & Offer

- Helper: ส่งข้อเสนอ (price + message) แล้ว **ถอนได้** ขณะ `pending`
- Requester: **รับ** หรือ **ปฏิเสธ** ข้อเสนอ
- สถานะ: `pending` | `accepted` | `rejected` | `withdrawn` | `expired`
- คอลัมน์เพิ่ม: `eta_hours`, `expires_at`, `reject_reason` (พร้อมใช้ต่อ)

## Chat + Evidence

- `job_messages` — คุยเฉพาะคู่สัญญา (เจ้าของงาน + helper ที่ assigned)
- `job_evidence` — อัปโหลดรูป/PDF เข้า bucket `documents` path `job-evidence/{jobId}/...`
- UI: `JobWorkspace` บนการ์ดงาน (matched / in_progress / done)

## Safety

- `user_blocks` — บล็อกสองทาง (ไม่โผล่ใน match)
- `safety_reports` — รายงานเหตุผล + รายละเอียด, admin เห็น status
- Matching กรอง helper ที่ถูกบล็อกกับเจ้าของงาน

## Deploy

1. `npx supabase db push` (migration `20260924120000_marketplace_v2.sql`)
2. Copy ไฟล์ใน zip ทับ repo → commit → Netlify

## ขอบเขตที่ยังไม่ทำ (ต่อได้)

- Counter-offer หลายรอบ / หมดอายุอัตโนมัติใน cron
- หน้า Admin จัดการ safety_reports
- Realtime chat (ตอนนี้ poll 15s)
