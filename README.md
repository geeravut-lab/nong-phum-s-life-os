# น้องภูมิ — Nong Phum's Life OS

ผู้ช่วยส่วนตัวที่ช่วยดูแลเรื่องจุกจิกรอบตัว: อ่านเอกสารจากรูปถ่ายหรือ PDF, เตือนความจำ, บันทึกรายรับ-รายจ่าย, แชร์เรื่องสำคัญกับครอบครัว และสรุปให้ฟังทุกเช้า

## Stack

| ส่วน | ใช้อะไร |
|---|---|
| Framework | TanStack Start (React 19) + TanStack Router / Query |
| Build | Vite 8 |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) |
| Database / Auth / Storage | Supabase (Postgres + RLS) |
| AI | Vercel AI SDK v7 — สลับ provider ได้ระหว่าง Anthropic / OpenAI / Google |
| Deploy | Netlify (`@netlify/vite-plugin-tanstack-start`) |

## ต้องมีก่อนเริ่ม

- **Node.js 20.19+ หรือ 22.12+** (ข้อกำหนดของ Vite 8)
- **Supabase CLI** — ติดตั้งผ่าน Homebrew / Scoop / standalone binary หรือใช้ `npx supabase` ได้เลย
  (Supabase **ไม่รองรับ** การติดตั้งผ่าน `npm i -g supabase`)
- Supabase project ของตัวเอง และ API key ของ AI provider อย่างน้อย 1 เจ้า

## รันในเครื่อง

```sh
npm install
cp .env.example .env.local   # แล้วเติมค่าจริงลงไป
npm run dev
```

เปิด http://localhost:5173

## Environment variables

คัดลอกจาก `.env.example` ดูคำอธิบายเต็มในนั้น สรุปย่อ:

| ตัวแปร | ฝั่ง | หมายเหตุ |
|---|---|---|
| `VITE_SUPABASE_URL` | client | เปิดเผยได้ |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client | เปิดเผยได้ (RLS คุ้มครองอยู่) ใช้ key แบบใหม่ `sb_publishable_...` |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | server | fallback ตอน SSR ตั้งค่าเดียวกับตัว `VITE_` |
| `SUPABASE_SERVICE_ROLE_KEY` | server | `sb_secret_...` ข้ามผ่าน RLS ได้หมด — **ห้ามขึ้นต้นด้วย `VITE_`** |
| `AI_PROVIDER` | server | `anthropic` \| `openai` \| `google` (ไม่ใส่ = `anthropic`) |
| `AI_FALLBACK_PROVIDER` | server | เว้นว่าง = ปิด fallback |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | server | ใส่เฉพาะเจ้าที่ใช้ — **ห้ามขึ้นต้นด้วย `VITE_`** |

ถ้า `AI_PROVIDER` ชี้ไปเจ้าที่ยังไม่มี key แอปจะ **throw ทันทีตอน request แรก** พร้อมบอกชื่อ env ที่ขาด แทนที่จะไปพังตอนผู้ใช้กดใช้งาน

## Database

Migration ทั้งหมดอยู่ใน `supabase/migrations/` รันขึ้น project ใหม่ด้วย:

```sh
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

หลัง push ต้องสร้าง storage bucket ชื่อ **`documents`** แบบ **private** เองใน Dashboard — ไม่มี migration ไหนสร้าง bucket ให้ ส่วน RLS policy ของ bucket มาพร้อม migration แล้ว ไม่ต้องสร้างซ้ำ

## Scripts

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run preview` | เปิดดู build ที่ทำไว้ |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Deploy

ผูก repo กับ Netlify (Add new site → Import from Git) ตั้ง production branch เป็น `main` แล้วใส่ environment variables ตามตารางด้านบนใน Netlify UI — อย่าลืมเพิ่ม URL ของ Netlify เข้าไปใน Supabase Auth → URL Configuration ทั้ง Site URL และ Redirect URLs
