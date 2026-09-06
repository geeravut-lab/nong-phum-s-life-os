# Phase 0 — ย้ายออกจาก Lovable → Supabase (ของเราเอง) + Netlify

เอกสารนี้เป็นแผนปฏิบัติสำหรับ repo `nong-phum-s-life-os`
**เป้าหมาย: หลังจบ Phase 0 ระบบเดิมทั้ง 10 หน้าต้องทำงานได้ครบเหมือนเดิม โดยไม่มี dependency กับ Lovable เหลืออยู่เลย**

ห้ามเพิ่มฟีเจอร์ใหม่ใน Phase นี้ ทุกอย่างที่เพิ่มจะทำให้แยกไม่ออกว่า bug มาจากการย้ายหรือจากของใหม่

---

## 0. สิ่งที่เจ้าของโปรเจกต์ต้องเตรียมเอง (AI ทำแทนไม่ได้)

| # | สิ่งที่ต้องทำ | ได้อะไรกลับมา |
|---|---|---|
| 1 | สมัคร/เปิด Supabase project ใหม่ **region: Southeast Asia (Singapore)** | `SUPABASE_URL`, `anon key`, `service_role key`, `DB password` |
| 2 | สร้าง Supabase Personal Access Token (Account → Access Tokens) | token สำหรับ `supabase login` |
| 3 | สมัคร AI provider + เติมเครดิต **อย่างน้อย 1 เจ้า** (ระบบรองรับ 3 เจ้า สลับได้) | `ANTHROPIC_API_KEY` และ/หรือ `OPENAI_API_KEY` และ/หรือ `GOOGLE_GENERATIVE_AI_API_KEY` |
| 4 | สมัคร Netlify + เชื่อม GitHub repo | site ว่าง ๆ 1 site |
| 5 | ติดตั้งในเครื่อง: Node 20+, `npm i -g supabase` | CLI พร้อมใช้ |

**ข้อควรระวังเรื่อง key:** `service_role` key ข้ามผ่าน RLS ได้ทั้งหมด ห้ามใส่ในตัวแปรที่ขึ้นต้นด้วย `VITE_` และห้าม commit ลง git เด็ดขาด ใช้ได้เฉพาะในไฟล์ `*.server.ts` เท่านั้น

---

## 1. สิ่งที่ต้องถอดออก (Lovable dependency ที่ฝังอยู่)

จากการตรวจ repo พบจุดผูกกับ Lovable ดังนี้:

| ตำแหน่ง | ปัญหา | ทำอย่างไร |
|---|---|---|
| `vite.config.ts` | ใช้ `@lovable.dev/vite-tanstack-config` ซึ่งห่อ tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (default preset = cloudflare), VITE_ env injection, `@` alias, dedupe, error logger, sandbox detection ไว้ทั้งหมด | เขียน `vite.config.ts` ใหม่แบบ explicit |
| `package.json` → `@lovable.dev/cloud-auth-js` | ระบบ auth ของ Lovable | ถอดออก ใช้ `supabase.auth` แทน |
| `bun.lock` | มี URL ชี้ไป private registry `europe-west1-npm.pkg.dev/lovable-core-prod/...` หลายรายการ **จะติดตั้งไม่ผ่านนอก Lovable** | ลบ `bun.lock` ทิ้ง แล้ว generate `package-lock.json` ใหม่ด้วย npm |
| `src/lib/ai-gateway.server.ts` | ยิงไป `https://ai.gateway.lovable.dev/v1` ด้วย `LOVABLE_API_KEY` | เปลี่ยน provider |
| `src/lib/lovable-error-reporting.ts` | ส่ง error กลับ Lovable | ถอดออก หรือแทนด้วย console/Sentry |
| `src/routes/__root.tsx` | meta `author: "Lovable"`, `twitter:site: "@Lovable"` | แก้เป็นของเรา |
| `README.md` | เนื้อหา Lovable ทั้งไฟล์ | เขียนใหม่ |
| `src/integrations/supabase/client.ts` | ชี้ Lovable Cloud | ชี้ Supabase project ใหม่ |

---

## 2. ลำดับงาน (ทำทีละขั้น — commit ทุกขั้น อย่ารวบ)

### ขั้น 2.1 — ตั้งฐาน
- [ ] `git checkout -b phase-0/migrate-off-lovable`
- [ ] ลบ `bun.lock`, ลบ `node_modules`
- [ ] เปลี่ยน `package.json` → `"name": "nong-phum-life-os"`
- [ ] ถอด `@lovable.dev/cloud-auth-js` และ `@lovable.dev/vite-tanstack-config` ออกจาก dependencies
- [ ] `npm install` → ต้องได้ `package-lock.json` ใหม่ที่ไม่มี URL ของ lovable-core-prod เลย (ตรวจด้วย `grep lovable package-lock.json` ต้องไม่เจอ)

### ขั้น 2.2 — เขียน `vite.config.ts` ใหม่แบบ explicit

ต้องประกอบ plugin เองให้ครบตามที่ config เดิมเคยห่อไว้ **ลำดับ plugin สำคัญ** และต้องคง `tanstackStart({ server: { entry: "server" } })` ไว้ เพราะ `src/server.ts` เป็น SSR error wrapper ที่ใช้อยู่

โครงคร่าว ๆ:

```ts
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import netlify from "@netlify/vite-plugin-tanstack-start";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: "server" } }),
    netlify(),
    viteReact(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
});
```

- [ ] `npm i -D @netlify/vite-plugin-tanstack-start`
- [ ] ตรวจว่า alias `@/*` ยังทำงาน (มาจาก `tsconfig.json` → `paths` ผ่าน `vite-tsconfig-paths`)
- [ ] ตรวจว่า `npm run dev` ขึ้นได้และหน้าแรก render
- [ ] ถ้า nitro preset ชนกัน ให้ยึด plugin ของ Netlify เป็นหลัก และถอด `nitro` ออกจาก devDependencies

> หมายเหตุ: TanStack Start เวอร์ชันนี้เปลี่ยนวิธีตั้ง preset มาหลายรอบ (เดิม `app.config.ts` → `server.preset`, ต่อมา `nitro/vite`, ปัจจุบัน Netlify มี plugin เฉพาะ) **ให้ยึดเอกสารทางการของ TanStack Start เวอร์ชันที่ติดตั้งจริงเป็นหลัก อย่ายึดตัวอย่างข้างบนถ้าขัดกัน**

### ขั้น 2.3 — ย้าย Database

- [ ] `supabase login` แล้ว `supabase link --project-ref <ref-ใหม่>`
- [ ] ตรวจ migration ทั้งหมดใน `supabase/migrations/` ตามลำดับเวลา:
  - `20260821174814_*` — profiles, user_roles, has_role(), families, family_members, is_family_member(), documents, reminders, expenses, chat_messages
  - `20260825024438_*` — incomes
  - `20260903003503_*` — helper_profiles, jobs, job_offers, job_reviews, platform_settings
  - `20260904035427_*` — benefits, benefit_profiles, user_benefits
  - (+ migration อื่นที่มีในโฟลเดอร์ — ตรวจให้ครบ อย่าเดา)
- [ ] `supabase db push` → รันทั้งชุดขึ้น project ใหม่
- [ ] ตรวจว่า RLS เปิดครบทุกตาราง: `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';` — ต้องเป็น `true` ทุกแถว
- [ ] สร้าง storage bucket ชื่อ **`documents`** แบบ private + policy ให้ owner อ่าน/เขียนของตัวเองได้ (โค้ดใน `docs.tsx` ใช้ `createSignedUrl` อยู่แล้ว จึงต้องเป็น private)
- [ ] ถ้ามีข้อมูลจริงใน Lovable Cloud ที่ต้องเก็บ ให้ `pg_dump --data-only` ออกมาแล้ว restore; ถ้าเป็นข้อมูลทดสอบ ข้ามได้
- [ ] เขียน seed สำหรับ `benefits` และ `platform_settings` (`platform_settings` ต้องมี 1 แถว `id = true` ไม่งั้นหน้า Help Me จะพัง)

### ขั้น 2.4 — Auth

- [ ] `src/integrations/supabase/client.ts` → ใช้ `createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)`
- [ ] แทนที่ทุกจุดที่ใช้ `@lovable.dev/cloud-auth-js` ด้วย `supabase.auth` (`signInWithPassword`, `signUp`, `signInWithOAuth({ provider: 'google' })`, `signOut`, `getUser`)
- [ ] `src/routes/_authenticated/route.tsx` ใช้ `supabase.auth.getUser()` อยู่แล้ว — ตรวจว่ายังทำงานหลังเปลี่ยน client
- [ ] เปิด Email provider + Google OAuth ใน Supabase Dashboard และใส่ redirect URL ของ Netlify
- [ ] **ตรวจ trigger สร้าง `profiles` row ตอน sign up** — ตาราง `profiles` ใช้ `id` เป็น PK ที่อ้าง `auth.uid()` ถ้าเดิม Lovable จัดการให้ ต้องเขียน trigger `on auth.users insert` เองใน migration ใหม่ ไม่งั้นผู้ใช้ใหม่จะไม่มี profile

### ขั้น 2.5 — AI Layer แบบสลับ provider ได้ (Anthropic / OpenAI / Gemini)

**เป้าหมาย:** เปลี่ยน provider ได้ด้วยการแก้ env ตัวเดียว โดยไม่ต้องแตะโค้ดที่เรียกใช้เลย และรองรับการเพิ่ม provider ที่ 4 ในอนาคต

ทั้งสามเจ้าใช้ Vercel AI SDK (`ai` v7) ที่ติดตั้งอยู่แล้ว จึงมี interface เดียวกัน

- [ ] `npm i @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google`
- [ ] ถอด `@ai-sdk/openai-compatible` ออก (ใช้เฉพาะกับ Lovable Gateway)

#### 2.5.1 เขียน `src/lib/ai-provider.server.ts` (ไฟล์ใหม่)

ไฟล์นี้ทำหน้าที่เดียว: แปลง env → model instance

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export type ProviderId = "anthropic" | "openai" | "google";

// งานคนละแบบใช้ model คนละขนาดได้ ประหยัดเงินและเร็วขึ้น
export type TaskKind = "chat" | "document" | "reasoning";

type ProviderConfig = {
  envKey: string;
  models: Record<TaskKind, string>;
  supportsPdf: boolean;
  create: (apiKey: string) => (modelId: string) => unknown;
};

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    models: { chat: "<model-เล็ก>", document: "<model-ใหญ่>", reasoning: "<model-ใหญ่>" },
    supportsPdf: true,
    create: (k) => createAnthropic({ apiKey: k }),
  },
  openai: {
    envKey: "OPENAI_API_KEY",
    models: { chat: "<model-เล็ก>", document: "<model-ใหญ่>", reasoning: "<model-ใหญ่>" },
    supportsPdf: true,
    create: (k) => createOpenAI({ apiKey: k }),
  },
  google: {
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    models: { chat: "<model-เล็ก>", document: "<model-ใหญ่>", reasoning: "<model-ใหญ่>" },
    supportsPdf: true,
    create: (k) => createGoogleGenerativeAI({ apiKey: k }),
  },
};

export function resolveProvider(): ProviderId { /* อ่าน AI_PROVIDER, default "anthropic" */ }
export function getModel(task: TaskKind, override?: ProviderId) { /* ... */ }
export function providerSupportsPdf(id: ProviderId): boolean { /* ... */ }
export function availableProviders(): ProviderId[] { /* เจ้าที่มี API key ครบเท่านั้น */ }
```

- [ ] **ห้าม hardcode ชื่อรุ่นโมเดลจากความจำ** — ตอนลงมือทำให้เปิดหน้า models ของแต่ละเจ้าแล้วใส่ชื่อรุ่นล่าสุดที่ใช้งานได้จริง แล้วเขียนคอมเมนต์กำกับวันที่ตรวจสอบไว้
- [ ] `availableProviders()` ต้องคืนเฉพาะเจ้าที่มี API key จริงใน env — ใช้ทั้งตอน validate ตอน boot และตอนทำ Admin UI ใน Phase 1
- [ ] ถ้า `AI_PROVIDER` ชี้ไปเจ้าที่ไม่มี key → throw ตอน startup พร้อมข้อความบอกชัดว่าขาด env ตัวไหน อย่าปล่อยให้ไป fail ตอน user กดใช้งาน

#### 2.5.2 เขียน `src/lib/ai-gateway.server.ts` ใหม่

- [ ] **คง export เดิมไว้ทั้งหมด**: `PHUM_PERSONA_TH`, `PHUM_PERSONA_EN`, `persona(lang)` — เพื่อไม่ต้องแก้ไฟล์อื่น
- [ ] เปลี่ยน `requireGateway()` → `getModel(task)` จาก `ai-provider.server.ts` แล้วแก้จุดเรียกใน `phum.server.ts`
- [ ] ลบ `createLovableAiGatewayProvider` ทิ้ง

#### 2.5.3 เปลี่ยนวิธีดึง JSON — สำคัญที่สุดของขั้นนี้

โค้ดเดิมใช้ `generateText` แล้วเอา `result.text` มา `parseJsonOutput()` เข้า zod ซึ่ง **จะพังไม่เหมือนกันในแต่ละ provider** (บางเจ้าใส่คำนำ บางเจ้าห่อด้วย ```json บางเจ้าเติม trailing comma)

- [ ] เปลี่ยนไปใช้ **`generateObject({ model, schema })`** ของ AI SDK แทน
- [ ] AI SDK จะแปลง zod schema เป็นกลไก structured output ที่เหมาะกับแต่ละเจ้าให้เอง (Anthropic ใช้ tool use, OpenAI ใช้ json_schema, Google ใช้ responseSchema) → ได้ผลลัพธ์ที่ valid โดยไม่ต้องพึ่งการ prompt ให้ตอบ JSON
- [ ] schema เดิมที่ต้องย้ายมา: `DocSchema` (ใน `analyzeDocument`) และ `ActionSchema` (action router)
- [ ] ลบ `JSON_ONLY` และ `parseJsonOutput` ออกได้หลังย้ายครบ
- [ ] `ActionSchema` ใช้ `.nullable()` เยอะ — Google กับ OpenAI จัดการ nullable ไม่เหมือน Anthropic ถ้าเจอปัญหา ให้เปลี่ยนเป็น `.optional()` หรือใส่ default แทน แล้วทดสอบซ้ำทั้ง 3 เจ้า

#### 2.5.4 `analyzeDocument` — จุดที่ต่างกันมากที่สุดระหว่าง provider

ฟังก์ชันนี้ส่ง base64 เข้าไปเป็น `type: "image"` หรือ `type: "file"` (PDF)

- [ ] รูปภาพ (`image/*`) — ทั้ง 3 เจ้ารองรับ ใช้ interface เดียวกันของ AI SDK ได้
- [ ] PDF — พฤติกรรมและข้อจำกัด (ขนาดไฟล์, จำนวนหน้า, ต้องอัปโหลดก่อนไหม) **ต่างกันจริง** ให้ทดสอบไฟล์ PDF จริงกับทั้ง 3 เจ้าก่อนสรุป
- [ ] เขียน guard: ถ้า provider ที่เลือกอยู่จัดการ PDF ไม่ได้ ให้ throw ข้อความภาษาไทยที่เข้าใจง่าย ("ตอนนี้น้องภูมิอ่าน PDF ไม่ได้ครับ ลองถ่ายรูปเอกสารแทน") ไม่ใช่ปล่อย error ดิบ
- [ ] เพิ่มขีดจำกัดขนาดไฟล์ฝั่ง client ก่อนส่งขึ้น server

#### 2.5.5 Fallback (ทำเลยตอนนี้ ถูกกว่าไปเพิ่มทีหลัง)

- [ ] ถ้าเรียก provider หลักแล้ว error (rate limit / 5xx / timeout) ให้ retry ด้วย provider สำรองจาก `availableProviders()` อัตโนมัติ 1 ครั้ง
- [ ] log ทุกครั้งที่ fallback ทำงาน — จะได้รู้ว่าเจ้าไหนล่มบ่อย
- [ ] ควบคุมด้วย env `AI_FALLBACK_PROVIDER` (เว้นว่าง = ปิด fallback)

#### 2.5.6 เตรียมทางให้ Admin สลับได้ใน Phase 1 (optional แต่แนะนำ)

- [ ] เพิ่ม migration เล็ก ๆ: `ALTER TABLE public.platform_settings ADD COLUMN ai_provider text;` (nullable = ใช้ค่าจาก env)
- [ ] ให้ `resolveProvider()` อ่านลำดับ: `platform_settings.ai_provider` → `AI_PROVIDER` → default
- [ ] **API key ยังคงอยู่ใน env เท่านั้น ห้ามเก็บลง database** DB เก็บได้แค่ว่า "เลือกเจ้าไหน" ไม่ใช่ "key คืออะไร"

### ขั้น 2.6 — ล้างร่องรอย Lovable

- [ ] ลบ `src/lib/lovable-error-reporting.ts` และการเรียกใน `src/routes/__root.tsx` (แทนด้วย `console.error` ไปก่อน)
- [ ] แก้ meta ใน `__root.tsx`: `author`, `twitter:site`, และเพิ่ม `og:image` ของเราเอง
- [ ] เขียน `README.md` ใหม่: stack, วิธีรัน local, env ที่ต้องมี, วิธี deploy
- [ ] ลบโฟลเดอร์ `.lovable/`
- [ ] `grep -ri lovable src/ package.json vite.config.ts` → ต้องไม่เหลืออะไร

### ขั้น 2.7 — Deploy Netlify

- [ ] สร้าง `netlify.toml`: `command = "npm run build"`, `publish` และ functions ตามที่ plugin กำหนด
- [ ] ตั้ง environment variables ใน Netlify UI:

| ตัวแปร | ฝั่ง | หมายเหตุ |
|---|---|---|
| `VITE_SUPABASE_URL` | client | เปิดเผยได้ |
| `VITE_SUPABASE_ANON_KEY` | client | เปิดเผยได้ (RLS คุ้มครองอยู่) |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **ห้ามขึ้นต้น VITE_** |
| `AI_PROVIDER` | server | `anthropic` \| `openai` \| `google` (ไม่ใส่ = anthropic) |
| `AI_FALLBACK_PROVIDER` | server | เว้นว่าง = ปิด fallback |
| `ANTHROPIC_API_KEY` | server | ใส่เฉพาะเจ้าที่จะใช้ · **ห้ามขึ้นต้น VITE_** |
| `OPENAI_API_KEY` | server | **ห้ามขึ้นต้น VITE_** |
| `GOOGLE_GENERATIVE_AI_API_KEY` | server | **ห้ามขึ้นต้น VITE_** |

- [ ] Deploy preview ก่อน → ทดสอบ → แล้วค่อย production
- [ ] เพิ่ม redirect URL ของ Netlify เข้าไปใน Supabase Auth settings
- [ ] ปิด auto-sync ของ Lovable ที่ผูกกับ GitHub repo นี้ (ไม่งั้น Lovable อาจ push ทับ)

---

## 3. Checklist ทดสอบก่อนปิด Phase 0

ทำจริงในเบราว์เซอร์ ไม่ใช่แค่ build ผ่าน:

- [ ] สมัครสมาชิกใหม่ด้วยอีเมล → มีแถวใน `profiles` อัตโนมัติ
- [ ] Login / Logout / Login ด้วย Google
- [ ] **Docs** — อัปโหลดรูปใบแจ้งค่าไฟ → น้องภูมิอ่านได้ สรุปได้ ดึงวันครบกำหนด/ยอดเงินได้ → กด "เปิดไฟล์" แล้ว signed URL ใช้ได้
- [ ] Docs → กด "สร้างการเตือนจากเอกสารนี้" แล้วไปโผล่ในหน้า Tasks
- [ ] **Chat** — พิมพ์ "เตือนจ่ายค่าน้ำวันศุกร์" → ได้ action card → กดยืนยัน → เข้า Tasks
- [ ] Chat — พิมพ์ "จ่ายค่าไฟ 850 เมื่อวาน" → เข้า Money
- [ ] **ทดสอบครบทั้ง 3 provider** — สลับ `AI_PROVIDER` เป็น `anthropic` / `openai` / `google` แล้วรันซ้ำ 3 ข้อนี้ทุกเจ้า: อ่านรูปเอกสาร, อ่าน PDF, chat router สร้าง reminder
- [ ] ตั้ง `AI_PROVIDER` เป็นเจ้าที่ไม่มี key → ต้องขึ้น error ชัดเจนตอน start ไม่ใช่ตอน user กดใช้
- [ ] ตั้ง `AI_FALLBACK_PROVIDER` แล้วทำให้เจ้าหลักพัง (ใส่ key ผิด) → ต้องสลับไปเจ้าสำรองได้และมี log
- [ ] **Money** — รายรับ/รายจ่าย/ยอดคงเหลือ/สรุปตามหมวด แสดงถูก
- [ ] **Today** — Daily Brief generate ได้
- [ ] **Family** — สร้างครอบครัว → เอา invite code ไป join ด้วยบัญชีที่ 2 → แชร์เอกสาร 1 ฉบับ → บัญชีที่ 2 เห็น
- [ ] **สำคัญ: ทดสอบ RLS จริง** — บัญชี A ต้อง**ไม่**เห็นเอกสาร/ค่าใช้จ่าย/reminder ของบัญชี B ที่ไม่ได้แชร์
- [ ] **Help Me** — สร้าง helper profile, โพสต์งาน, ยื่นข้อเสนอด้วยอีกบัญชี, ตอบรับ, ปิดงาน, ให้คะแนน
- [ ] **Benefits** — กรอกโปรไฟล์ → ได้ผลลัพธ์สิทธิ
- [ ] Settings — สลับ ไทย/อังกฤษ และ light/dark
- [ ] เปิดบนมือถือจริง — layout ไม่แตก
- [ ] `npm run build` ผ่านโดยไม่มี TS error (tsconfig เปิด strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` ซึ่งเข้มมาก)

---

## 4. Definition of Done

Phase 0 จบเมื่อ:

1. Production URL บน Netlify ใช้งานได้ครบทุกข้อในหัวข้อ 3
2. `grep -ri lovable` ใน source ไม่เจออะไร
3. `package-lock.json` ไม่มี private registry ของ Lovable
4. ปิด Lovable project แล้วแอปยังทำงานปกติ
5. มี `.env.example` ในrepo ที่บอกครบว่าต้องมี env อะไรบ้าง

---

## 5. Roadmap ถัดไป (อ้างอิงเฉย ๆ อย่าเพิ่งทำ)

| Phase | ขอบเขต |
|---|---|
| 1 | Payment rails (PromptPay QR + ผ่อน) · LINE Messaging API · Admin Dashboard โครงหลัก |
| 2 | Task Marketplace v2 เต็มสเปก (Match Score, Offer, Escrow, Safety, Provider Dashboard, AI Price Guidance) |
| 3 | สิทธิฉัน v2 + Decision Board |
| 4 | ของดีใกล้บ้าน (ต้องเพิ่ม PostGIS + Merchant Dashboard) |
| 5 | Life Legacy A — Asset Inventory, Vault, Final Wishes, Trusted Contacts, Checklist, AI Legacy Assistant |
| 6 | Life Legacy B — Death Verification, Post-Life Action Plan, Memorial, Digital Wreath, AI Funeral Planner |

### หลักการที่ต้องยึดตั้งแต่ตอนนี้

- **Death Verification และการเปิดเผยข้อมูลใน Life Legacy ต้องเป็น deterministic logic เท่านั้น ห้าม AI ตัดสิน** — ต้องแยกเป็น service ของตัวเอง มี multi-confirmation และ audit log ทุก event
- **พินัยกรรม** — ระบบเก็บ "สำเนาและตำแหน่งของฉบับจริง" ไม่ใช่ "ทำพินัยกรรม" ต้องมีข้อความกำกับให้ชัดในหน้า UI
- **เงินที่รับแทนผู้อื่น** (ค่า package งานศพ, พวงหรีด, เงินช่วยงาน, escrow ของ marketplace) ต้องผ่าน payment gateway ที่มีใบอนุญาต และควรปรึกษาที่ปรึกษากฎหมายก่อนเปิดใช้จริง
- **PDPA** — ทุกตารางที่เก็บข้อมูลอ่อนไหวต้องมี consent record + audit log + เส้นทางลบข้อมูล ออกแบบไว้ตั้งแต่ migration แรกของโมดูลนั้น
