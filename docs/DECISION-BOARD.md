# Phase 3 — Decision Board

## Route

`/decide` — เมนู «ช่วยตัดสินใจ»

## Flow

1. พิมพ์คำถาม + เลือก template (ไม่บังคับ)
2. AI สร้าง **Decision Board** (เกณฑ์ + ทางเลือก + คะแนน + แนะนำ)
3. ถ้าข้อมูลไม่พอ → follow-up questions → วิเคราะห์ใหม่
4. เลือกทางเลือก / บันทึก outcome ใน journal

## Tables

`decisions` — question, context, board (jsonb), recommendation, status, outcome

## Deploy

```bash
npx supabase db push
# copy files, commit, Netlify
```
