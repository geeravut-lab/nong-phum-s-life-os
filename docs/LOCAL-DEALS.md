# Phase 4 — ของดีใกล้บ้าน (Local Deals)

## Routes

- `/local` — AI search + รายการสถานที่/ดีล + ใช้ตำแหน่งผู้ใช้
- `/local/merchant` — Merchant dashboard (เพิ่มร้าน + โปรโมชัน)

## Tables

- `local_places` — lat/lng, tags, price_level, open_hours
- `local_deals` — โปรโมชันผูก place
- `place_reviews` — รีวิว + trigger คำนวณ rating

## หมายเหตุ

- ใช้ Haversine บน lat/lng แทน PostGIS (deploy ง่ายบน Supabase)
- มี seed ตัวอย่างย่านบางนา/ศรีนครินทร์

## Deploy

```bash
npx supabase db push
```
