# Knowledge: สิ่งที่ Grok ปรับใน Life OS (ถึง 2026-09-26)

เอกสารส่งต่อ Claude / dev — สรุปงานในเซสชัน Life OS (`nong-phum-s-life-os` / lavieos.netlify.app)

## สแต็ก
- TanStack Start + React + Vite
- Supabase (Auth, Postgres, Realtime)
- Netlify (`npm run build`, `netlify/functions`)
- i18n: `src/lib/i18n.dict.ts` (th/en, type `Dict`)
- Server fn: `createServerFn` + `requireSupabaseAuth`

## Billing / Premium / Family / PAYG
- ตาราง: `premium_payments`, `ai_usage_monthly`, คอลัมน์ billing บน `platform_settings`
- **Flow เหมือนบริจาค:** กดอัปเกรด → แสดง QR **ไม่ insert** → 「แจ้งว่าโอนแล้ว」→ insert `pending` → Admin ยืนยัน/ปฏิเสธ
- `plan_tier`: `premium` | `family` | `payg`
- `payment_status`: `pending` | `paid` | `rejected` (+ `draft` legacy)
- Admin UI: `/admin/premium` — ไฟล์ `admin_.premium.tsx`, route `createFileRoute("/_authenticated/admin_/premium")`
- ชื่อการ์ด/หัวข้อ: **ชำระเงิน Premium / Family / PAYG** (`billPremiumPayCard`)
- ประวัติ Admin: ชื่อผู้ใช้, วันที่-เวลา, แพ็ก (Premium/Family/PAYG), ช่องทาง/อ้างอิง, ยอด, สถานะ i18n
- รายการผู้ใช้: `listMyPremiumPayments` กรองเฉพาะ pending/paid/rejected
- ล้าง draft เก่า: `DELETE FROM premium_payments WHERE payment_status = 'draft';`
- แสดงแพ็ก: `profiles.plan_tier` + badge sidebar + หน้า `/support`
- ปุ่มอัปเกรด disabled เมื่อเป็นแพ็กนั้นอยู่แล้ว (Premium ปิดเมื่อ premium/family; Family ปิดเมื่อ family)

## บริจาค
- Insert เฉพาะตอนแจ้งโอน — ไม่มี draft

## Local / Maps
- `GOOGLE_MAPS_API_KEY` ฝั่ง server
- ปุ่มแผนที่: ใช้ `maps_url` ก่อน lat/lng
- โปรโมชันร้าน: แก้ไข/ลบ

## UI / i18n ที่สำคัญ
- `adminTitle` = ผู้ดูแลระบบ; `adminSub` ว่าง
- `attachReceipt` = แนบเอกสาร
- `billPremiumPayCard` = ชำระเงิน Premium / Family / PAYG
- `billStatusPaid` / `billStatusRejected` / `billHistoryTitle` ฯลฯ

## PWA
- `public/manifest.webmanifest`, `public/sw.js`
- Early capture `beforeinstallprompt` ใน `__root.tsx` → `window.__pwaDeferred`
- เมนู「ติดตั้งเป็นแอป」ใน AppShell

## Tasks / Agenda
- สวิตช์ใน `/tasks` = สถานะ done/open
- วันที่ปฏิทินเดือน: local date key
- `deleteAgendaItem` มีแล้ว

## ไฟล์ที่แตะบ่อย
- `src/lib/billing.functions.ts`
- `src/routes/_authenticated/support.tsx`
- `src/routes/_authenticated/admin.tsx`, `admin_.premium.tsx`
- `src/components/AppShell.tsx`
- `src/routes/__root.tsx`
- `src/lib/i18n.dict.ts`
- `src/routes/_authenticated/local.tsx`, `local_.merchant.tsx`
- `src/lib/agenda.functions.ts`, `agenda.tsx`
- `src/routes/_authenticated/tasks.tsx`
- `docs/FEATURE-MAP-AND-BACKLOG.md`
- `docs/GROK-SESSION-KNOWLEDGE.md`

## Build tips
- Route: `admin_.premium.tsx` → `"/_authenticated/admin_/premium"`
- อย่าใส่ key ใน Dict ที่ไม่มีใน type ทั้ง th/en
- Index signature: ใช้ `obj["key"]`
- เปรียบเทียบ `tier` ใน `.map` ของ `as const` — อย่าเทียบกับ literal ที่ type แคบกว่า (เช่น family map อย่าเทียบ `tier === "premium"`)

## งานค้าง
1. ชื่อผู้รับมอบหมายครบทุกหน้า + แก้ผู้รับ
2. จุดแดงกระพริบเมนูปฏิทินรวม
3. Modal แก้ไขนัด/งานครอบครัว = ปฏิทินรวม
4. Google Places เต็มเมื่อ API พร้อม
