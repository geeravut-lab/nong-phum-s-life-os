# Phase 3 — สิทธิฉัน v2

## ฟีเจอร์ใหม่
1. **AI Interview** — เล่าสถานะ / ตอบคำถาม → กรอก `benefit_profiles` อัตโนมัติ
2. **Deadlines** — แสดงกำหนดการจาก `deadline_month/day/note` + ปุ่มตั้ง reminder ใน Tasks
3. **Source freshness** — `source_name`, `verified_at` บนการ์ดสิทธิ
4. **Application guide** — ขยาย `how_to` ในรายการ

## Migration
`supabase/migrations/20260924170000_benefits_v2.sql`

## Deploy
```bash
npx supabase db push
# copy files, commit, push
```
