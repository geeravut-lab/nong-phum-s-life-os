# Knowledge: สิ่งที่ Grok ปรับใน Life OS (ห้องนี้ → 2026-09-26)

เอกสารนี้สรุปงานที่ทำในเซสชันพัฒนา Life OS (nong-phum-s-life-os) เพื่อส่งต่อ Claude / dev คนอื่น

## สแต็กหลัก
- TanStack Start + React + Vite
- Supabase (Auth, Postgres, Realtime)
- Netlify deploy (`npm run build`, functions ใต้ `netlify/functions`)
- i18n: `src/lib/i18n.dict.ts` (th/en, type `Dict`)
- Server fn: `createServerFn` + `requireSupabaseAuth`

## การเงิน / Billing
- ตาราง: `premium_payments`, `ai_usage_monthly`, คอลัมน์ billing บน `platform_settings`
- **Flow ใหม่ (เหมือนบริจาค):** กดอัปเกรด → แสดง QR **ไม่ insert DB** → กด「แจ้งว่าโอนแล้ว」→ insert `pending` → Admin ยืนยัน/ปฏิเสธ
- `plan_tier` รองรับ: `premium` | `family` | `payg`
- `payment_status`: `draft` (legacy) | `pending` | `paid` | `rejected` | …
- Admin: `/admin/premium` (ไฟล์ `admin_.premium.tsx`, route id `/_authenticated/admin_/premium`)
- หน้ารองรับ: รายการ「ชำระเงิน Premium / Family / PAYG ของฉัน」เฉพาะ pending/paid/rejected
- SQL ล้างของเก่า: `DELETE FROM premium_payments WHERE payment_status = 'draft';`

## บริจาค (อ้างอิง)
- Insert เฉพาะตอนผู้ใช้แจ้งโอน (`createDonation` → `pending`) — ไม่มี draft

## Local / Google Maps
- `searchGooglePlaces` อ่าน `GOOGLE_MAPS_API_KEY` (server env บน Netlify)
- ปุ่มแผนที่บนการ์ดสถานที่ใช้ **`maps_url`** ก่อน แล้วค่อย lat/lng
- ลิงก์สั้น `maps.app.goo.gl` มัก parse lat ไม่ได้ — เก็บ URL แล้วเปิดตรง ๆ
- แดชบอร์ดร้าน: แก้ไข/ลบโปรโมชัน (`local_deals`)

## UI / i18n
- `adminTitle` = 「ผู้ดูแลระบบ」ไม่ใช่ตั้งค่า AI; `adminSub` ว่าง
- `attachReceipt` = 「แนบเอกสาร」
- การ์ดคิว Admin (premium/support/safety/payments) อยู่ใต้หัวข้อ ก่อน「สถานะปัจจุบัน」

## PWA
- `public/manifest.webmanifest`
- `public/sw.js` (minimal) + register จาก `__root.tsx`
- จับ `beforeinstallprompt` ตั้งแต่ early script → `window.__pwaDeferred`
- เมนู「ติดตั้งเป็นแอป」ใน AppShell (ใต้ตั้งค่า)

## แผนสมาชิก (Free / Premium / Family)
- อ่านจาก `profiles.plan_tier` / `plan_expires_at`
- แสดง badge ที่ sidebar + การ์ดใน `/support`
- ปุ่มอัปเกรดของแพ็กปัจจุบันถูก disabled

## งาน / ปฏิทิน
- สวิตช์ใน `/tasks` ผูกกับสถานะ `done`/`open` (เดิมเป็น share family)
- `deleteAgendaItem` ใน `agenda.functions.ts`
- วันที่จุดปฏิทินเดือน: ใช้ local date key ไม่ใช่ UTC slice
- ลบนัดครอบครัวจากหน้า family (บางส่วน)

## ไฟล์สำคัญที่แตะบ่อย
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

## ข้อควรระวังตอน build
- Route file: `admin_.premium.tsx` → `createFileRoute("/_authenticated/admin_/premium")`
- อย่าใช้ `supportNoPending` ถ้าไม่มีใน `Dict`
- Index signature: ใช้ `obj["key"]` กับ metadata / env
- Import `client.server` ต้อง dynamic ในบาง server fn (import-protection)

## งานค้างที่รู้แล้ว
1. ชื่อผู้รับมอบหมายครบทุกหน้า + แก้ผู้รับในฟอร์ม
2. จุดแดงกระพริบเมนูปฏิทินรวม (family events/tasks ใหม่)
3. Modal แก้ไขนัด/งานครอบครัวให้เดียวกับปฏิทินรวม
4. Google Places เต็มเมื่อ API key + Places API (New) พร้อมบน Netlify Functions
