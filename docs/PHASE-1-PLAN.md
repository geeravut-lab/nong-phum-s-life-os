# Phase 1 — Admin, Data Integrity, Notification & Payment

ต่อจาก `docs/PHASE-0-MIGRATION.md` ที่ปิดแล้ว

**หลักการที่ยังใช้ต่อ:** ทำทีละขั้น commit ทุกขั้น ตรวจแผนกับ repo จริงก่อนลงมือ และเมื่อแผนขัดกับสิ่งที่เห็นในโค้ด ให้เชื่อโค้ด

---

## ลำดับงาน

เลขหัวข้อคงที่ ลำดับทำจริงคือตารางนี้ (ปรับ 2026-09-12 หลังสำรวจงาน A–E เทียบ repo — ดู 1.6–1.10)

| ลำดับ | หัวข้อ | งาน | สถานะ | เหตุผลที่อยู่ตรงนี้ |
|---|---|---|---|---|
| 1 | **1.8 (hotfix)** | Timezone — Asia/Bangkok ทุกจุดที่ตัดสินว่า "วันนี้คือวันไหน" | ✅ `f4f5f69` | บั๊กที่ผู้ใช้เจอทุกเช้า 00:00–07:00 แก้ได้ 7 จุดโดยไม่แตะ schema ไม่มีเหตุผลให้รอ 1.2 |
| 2 | **1.6** | i18n guard — บังคับ key ครบสองภาษาตอน build | ✅ `777f553` | ต้องมาก่อน 1.1 เพราะหน้า Admin จะเพิ่ม key ใหม่หลายสิบตัว ใส่ guard ก่อนแล้วของใหม่จะถูกบังคับตั้งแต่บรรทัดแรก |
| 3 | **1.1** | Admin Console + AI provider/model switching | ✅ ทั้งขั้น (เหลือ cron ล้าง ai_events → 1.3) | ติดปัญหา quota รายวัน แก้แล้วได้ใช้ทันที และเป็นฐานของ Admin ที่ขั้นอื่นต้องใช้ |
| 4 | **1.7** | เปลี่ยนชื่อ "ค่าใช้จ่าย" + เก็บกวาด i18n รอบเดียว | ✅ 2026-09-14 | งาน rename 3 key ไม่ควรบล็อก 1.1 ทำพร้อมย้าย inline string กับ title เข้า dict |
| 5 | **1.2 + 1.8 (schema)** | Data integrity & deletion path + คำถามเชิง schema เรื่องเวลา | ✅ 2026-09-14 (เหลือ: โอน owner ครอบครัว → ก่อนมีครอบครัวจริง) | งาน schema ยิ่งมีข้อมูลจริงมากยิ่งเติม FK ย้อนหลังยาก · การตัดสินใจเรื่อง attachments (1.9) ต้องทำในรอบนี้ |
| 6 | **1.9** | แนบไฟล์ | ⏳ | ต้องรอ FK จาก 1.2 |
| 7 | **1.3** | Scheduler + LINE notification + Recurring reminder | ✅ 2026-09-14 (เหลือ LIFF → 1.5) | Netlify Scheduled Function ทุก 5 นาที · LINE ผูกเอง + Flex 2 โหมด + quota guard |
| 8 | **1.10** | เสียง | ⏳ | ต้องรอ 1.1 คุม quota ได้ก่อน เพราะวิธีที่ปลอดภัยใช้ RPD ×2 · และต้องผ่านด่าน `/mic-test` บนมือถือจริงก่อน |
| 9 | **1.4** | Payment rails | ⏳ | ใหญ่และเป็นอิสระ |
| 10 | **1.5** | งานค้างเล็ก ๆ | ⏳ | Help Me rating UI, `.validator()` deprecation, bundle 600 kB |

> 1.3 / 1.10 / 1.4 ไม่พึ่งพากัน สลับลำดับกันเองได้ตามความจำเป็นตอนนั้น
>
> **ระบบที่มีอยู่แล้วนอกแผน:** SSO จาก Aivora Hub อยู่บน production ตั้งแต่ 2026-09-13 และมีผู้ใช้จริง — ดูหัวข้อท้ายเอกสาร **ทุกงาน schema ตั้งแต่นี้ไปต้องถือว่า DB มีข้อมูลจริง**

---

# 1.1 Admin Console + AI Provider/Model Switching

## ปัญหาที่ต้องแก้

Gemini free plan มี quota รายวัน พอเต็มแล้วหน้า Chat กับ Docs พังทั้งคู่ ปัจจุบัน provider และ model ถูกกำหนดด้วย env ซึ่ง**ต้อง redeploy ถึงจะเปลี่ยนได้** ทำให้แก้ระหว่างวันไม่ทัน

## เป้าหมาย

Admin เปิดหน้าเว็บ เลือก provider และ model ได้เอง มีผลภายในไม่เกิน 1 นาที **โดยไม่ต้อง deploy ใหม่**

## 1.1.1 สิทธิ์ Admin

> **ตรวจแล้ว (ตรวจ repo 2026-09-08):** `admin` มีอยู่ใน enum แล้วตั้งแต่ migration แรก —
> `CREATE TYPE public.app_role AS ENUM ('admin','member')` **ไม่ต้องเขียน migration เพิ่ม**
> และไม่ได้มีไว้เฉย ๆ — policy `platform_settings_admin_write` เรียก `has_role(auth.uid(), 'admin')` อยู่แล้ว
>
> `has_role()` เองก็พร้อมใช้: `SECURITY DEFINER` + `SET search_path = public`,
> `GRANT EXECUTE TO authenticated` และ `REVOKE FROM anon, public` ฝั่ง client จึงเรียก
> `supabase.rpc('has_role', ...)` ได้เลยเพื่อซ่อนเมนู ไม่ต้องต่อท่อใหม่

- [ ] Bootstrap admin คนแรกด้วย SQL ตรง ๆ ใน Dashboard (ไม่ต้องทำ UI) — เจ้าของโปรเจกต์รันเอง:
      ```sql
      insert into public.user_roles (user_id, role)
      values ('26b22eca-67a8-4e2f-99ad-6f590f2fb072', 'admin')
      on conflict do nothing;
      ```
      (uuid = บัญชี `geeravut@gmail.com` · `user_roles` ไม่มี INSERT policy ให้ผู้ใช้ทั่วไป จึงต้องรันใน Dashboard เท่านั้น — ถูกต้องแล้ว)
- [x] guard ฝั่ง server — `requireAdmin` ใน `auth-middleware.ts` ต่อจาก `requireSupabaseAuth` แล้ว `rpc('has_role')` (`af23c77`)
- [x] Route `/admin` + ซ่อนเมนูฝั่ง client — ทำใน 1.1.6 (`c7956af`): `beforeLoad` เรียก `has_role` → redirect, `useIsAdmin` ซ่อนเมนู
- [x] ลบคอมเมนต์ "automatically generated" ใน `auth-middleware.ts` (`af23c77`) · `auth-attacher.ts` และ `client.server.ts` (`c20cefd`)

> **สำคัญ:** guard ฝั่ง client อย่างเดียวไม่พอ ใครก็พิมพ์ URL เข้าได้ การตรวจสิทธิ์จริงต้องอยู่ฝั่ง server ทุกครั้ง

## 1.1.2 ตารางเก็บค่า

- [x] ตาราง `ai_settings` แถวเดียว seed แล้ว — migration `20260913120000_ai_settings_and_events.sql` apply ด้วย `supabase db push` และ regen `types.ts` (`b28c373`)

เก็บ:

| คอลัมน์ | ความหมาย |
|---|---|
| `default_provider` | `anthropic` / `openai` / `google` หรือ **`NULL` = ไม่ได้ตั้งใน DB ถอยไปใช้ env** |
| `fallback_provider` | เจ้าสำรอง · `NULL` = ถอยไปใช้ env · **`'none'` = ปิด fallback** |
| `model_overrides` | `jsonb` เก็บเป็น `{"google": {"chat": "...", "document": "...", "reasoning": "..."}, "anthropic": {...}}` — คีย์ไหนไม่มี = ใช้ค่า default ในโค้ด |
| `updated_at`, `updated_by` | ใครแก้ เมื่อไหร่ (`updated_at` มี trigger) |

> **เปลี่ยนจากแผนเดิม:** เดิมเขียนว่า `NULL` ในช่อง fallback = ปิด แต่ถ้าทำแบบนั้น พอแถวมีอยู่ค่า `AI_FALLBACK_PROVIDER` จาก env จะถูกปิดทันที ขัดกับลำดับ DB → env → default ที่ตกลงกัน จึงใช้ `'none'` แทน ทั้งสองคอลัมน์มี CHECK จำกัดค่า

- [x] **API key ยังอยู่ใน env เท่านั้น** DB เก็บได้แค่ว่า "เลือกเจ้าไหน รุ่นไหน"
- [x] RLS ตาม pattern `platform_settings`: `SELECT ... USING (true)` ให้ `authenticated` · เขียนบังคับด้วย `has_role(auth.uid(),'admin')` ที่ชั้น DB · ไม่มี policy ให้ INSERT/DELETE (แถวเดียว seed แล้ว)

> **พบตอนทำ — pattern ต้นแบบมีรูรั่ว:** `platform_settings` มีแค่ `GRANT SELECT` ให้ `authenticated` ทำให้ policy `platform_settings_admin_write` **ไม่มีทางทำงานจาก client** เพราะไม่มีสิทธิ์ UPDATE ที่ระดับ GRANT — `ai_settings` จึง `GRANT SELECT, UPDATE` และบันทึกเรื่องนี้ไว้ให้ **1.4** แก้ `platform_settings` ตอนทำ UI ตั้ง commission

> **การอ่านฝั่ง server ใช้ `supabaseAdmin`:** 3 ใน 5 จุดที่เรียก AI (`runDocumentAnalysis`, `draftJobFromText`, `draftHelperSkills`) ไม่มี Supabase client ของผู้ใช้อยู่ในมือ การอ่านตารางที่ `authenticated` ทุกคนอ่านได้อยู่แล้วผ่าน service role ไม่ได้ข้ามการคุ้มครองอะไร และ `joinFamilyByCode` ทำแบบเดียวกันอยู่ก่อน — **"ไม่ใช้ service role" ยึดกับการเขียนและ RLS** ซึ่ง admin เขียนผ่าน JWT ตัวเอง ถ้าต้องการร้อย client ผ่านทุกจุดจริง ๆ เป็นงานแก้ ~4 signature

> ตารางนี้ไม่มีความลับอยู่แล้ว (key อยู่ใน env) เก็บแค่ชื่อ provider กับชื่อรุ่น
> การให้ `authenticated` อ่านได้จึงไม่เสียหาย และทำให้หน้า Admin อ่านค่าปัจจุบันได้ตรง ๆ
> ส่วนสิทธิ์เขียนถูกบังคับที่ชั้น DB ซึ่งเถียงไม่ได้ ต่อให้ลืม guard ฝั่ง server สักจุด

## 1.1.3 ลำดับความสำคัญของค่า

แก้ `resolveProvider()` และ `getModel()` ใน `ai-provider.server.ts` ให้อ่านตามลำดับ:

```
ai_settings (DB)  →  env (AI_PROVIDER)  →  ค่า default ในโค้ด
```

- [x] ทำแล้ว (`18c27e7`): `resolveProvider(task)` / `resolveFallbackProvider()` / `resolveModelId(id, task)` / `getModel()` เป็น async · `withProviderFallback()` ซับไว้ **call site 5 จุดไม่ต้องแก้** · จุดเดียวที่ต้องแก้คือเช็ค PDF ใน `runDocumentAnalysis` ที่เคย sync
- [x] `supportsPdf: boolean` → **`capabilities: { pdf, audio }`** ตั้งแต่รอบนี้ (ตรวจเอกสาร 2026-09-12: Google รับ audio ในการเรียกแชท · Anthropic รับ text+image เท่านั้น · OpenAI ต้องใช้ endpoint ถอดความแยก) — 1.1.6 และ 1.10 ต้องใช้
- [x] save guard: `updateAiSettings` ใน `admin.functions.ts` ปฏิเสธ provider ที่ไม่มี key **พร้อมชื่อ env var** และปฏิเสธ fallback ซ้ำ default

> **แก้แล้วใน 1.1.6:** `getAiConfig` / `updateAiSettings` เคยถูก tree-shake ออกจาก production bundle เพราะไม่มี route import ถึง (grep `dist/server` = 0) — พอ `/admin` import ก็อยู่ใน bundle (= 3) และเปิดหน้าบน production ได้ข้อมูลจริง

> **ที่คาดไว้ก่อนลงมือ vs ที่เกิดจริง:** คาดว่า async จะลามไป call site 5 จุด (6 ไฟล์) —
> ของจริงลามน้อยกว่านั้น เพราะ call site ทั้ง 5 เรียกผ่าน `withProviderFallback()` ที่ async อยู่แล้ว
> จุดเดียวที่ต้องแก้คือเช็ค PDF ใน `runDocumentAnalysis` ที่เรียก `resolveProvider()` ตรง ๆ แบบ sync

- [x] `assertAiProviderConfig()` ตอน boot คงไว้ doc ระบุชัดว่า**ตรวจ env อย่างเดียว** boot ผ่านไม่ได้แปลว่าค่าใน DB ดี
- [x] **runtime guard** ทำแล้ว: DB ชี้ไป provider ที่ไม่มี key → ถอยไปใช้ env provider + เขียน `ai_events` `error_code: missing_api_key` · **throttle 1 แถวต่อ 30 วิ** ไม่งั้นทุกคำขอจะเขียน 1 แถวตอน config พัง (ทดสอบแล้ว: เขียน `openai` ตรงเข้า DB ข้าม save guard → chat ยังทำงาน + มีแถว)

## 1.1.4 Cache — จุดที่พังง่ายที่สุด

อ่าน DB ทุกครั้งที่เรียก AI จะช้าและเปลืองโดยไม่จำเป็น แต่ถ้า cache นานไป admin เปลี่ยนค่าแล้วไม่มีผล

- [x] cache ระดับ module TTL **30 วินาที** · invalidate ตอน admin save (เฉพาะ instance ที่รับ save) · อ่าน DB พังไม่ทำให้ AI พัง — ใช้ค่าเก่าหรือถอยไป env (`18c27e7`)
      ทดสอบ: อ่านได้ anthropic → เขียน NULL ตรง DB → ที่ +14s ยังตอบ anthropic → ที่ +52s ตอบ google
- [ ] เขียนให้ชัดใน UI ว่า "การเปลี่ยนแปลงมีผลภายใน 1 นาที" → 1.1.6 (`getAiConfig` ส่ง `cacheTtlSeconds: 30` มาให้แสดงแล้ว)
- [x] บน Netlify Functions แต่ละ instance มี cache ของตัวเอง — TTL คือสิ่งเดียวที่รับประกันความสอดคล้อง (คอมเมนต์ไว้ที่ค่าคงที่ในโค้ด)

## 1.1.5 ดึงรายชื่อ model ที่ใช้ได้จริง ✅ `f896123` + `55bb5e9`

Admin ต้องเห็นรายการ model ทั้งหมดของแต่ละเจ้า ไม่ใช่พิมพ์ชื่อเอง (พิมพ์ผิดแล้วพังตอน runtime)

- [x] `listModels(provider)` ใน `src/lib/ai-models.server.ts` — endpoint ตรวจจากเอกสารทางการ 2026-09-13 อ้างอิงไว้ในหัวไฟล์: Google `GET /v1beta/models` (กรอง `supportedGenerationMethods` มี `generateContent`) · Anthropic `GET /v1/models` (ให้ `capabilities.image_input`/`pdf_input` มาด้วย → แสดง `✕img` ในช่อง document) · OpenAI `GET /v1/models` (ไม่มี type field ใช้ prefix `gpt-`/`o<เลข>` กรอง)
- [x] cache 1 ชั่วโมงต่อ instance — **cache ผลที่ล้มเหลวด้วย** ไม่งั้น vendor ล่มจะโดนยิงทุกครั้งที่เปิดหน้า
- [x] ล้มเหลว/ไม่มี key → คืนรายการ hardcode พร้อม `source: "hardcoded"` + `error` · หน้า Admin โชว์ป้าย "รายการจาก API" / "รายการในโค้ด" และข้อความ error ใน tooltip
- [x] แสดงเฉพาะ provider ที่มี key
- [x] **ต้องใช้ base URL เดียวกับที่ AI SDK ใช้** — พบบน production ว่า `@ai-sdk/openai` อ่าน `OPENAI_BASE_URL` และ `@ai-sdk/anthropic` อ่าน `ANTHROPIC_BASE_URL` (ตรวจใน `node_modules/@ai-sdk/*/dist` 2026-09-14) รอบแรก listModels ยิง host สาธารณะของ vendor ด้วย token ของ gateway → 401 ทั้งที่แชทผ่าน แก้แล้ว + โชว์ host ที่ใช้จริงใต้ชื่อ provider

> **คำตอบเรื่อง quota Gemini free tier — นับ RPD แยกรายโมเดล** (ตัดสินว่า console นี้แก้ปัญหาได้จริงแม้มี key เจ้าเดียว)
> - เอกสารทางการ ai.google.dev/gemini-api/docs/rate-limits ระบุตรง ๆ: *"Each model variation has an associated rate limit"* และ *"Limits vary depending on the specific model being used"* (limit ผูกกับ project ไม่ใช่ API key แต่**นิยามต่อ model**)
> - หลักฐานเชิงประจักษ์ 2026-09-13 ระหว่างทดสอบ 1.1.8: การทดสอบทั้งวันทำให้ `gemini-3.7-flash` ติด **429 quota exceeded** ขณะที่ **key เดียวกัน นาทีเดียวกัน** `gemini-3.6-flash` ✅ 1.5 วิ และ `gemini-3.8-flash` ✅ 4.5 วิ → สลับ chat ไป 3.6 ผ่านหน้า Admin แล้วแชทกลับมาใช้ได้ทันที
> - เคยเห็นแบบเดียวกันตอน Phase 0 (3.8 429 ขณะ 3.7 ผ่าน)

## 1.1.6 หน้า Admin ✅ `c7956af`

- [x] `/admin` ใน `src/routes/_authenticated/admin.tsx` — `beforeLoad` เรียก `has_role` แล้ว redirect ไป `/today` ถ้าไม่ใช่ admin · เมนู "ผู้ดูแลระบบ" โชว์เฉพาะ admin (`useIsAdmin` hook) — ทั้งสองเป็นความสะดวก ของจริงคือ `requireAdmin` + RLS
- [x] เลือก default / fallback provider (fallback มี "ปิด") · provider ที่ไม่มี key ถูก disable พร้อมบอกชื่อ env
- [x] ตาราง provider × task · Select จากรายการ live · ค่า "ค่าเริ่มต้น · <id ในโค้ด>" คือ null
- [x] ปุ่ม **ทดสอบ** ต่อช่อง — `testAiModel` ยิง `generateText` จริง 1 ครั้ง (`maxOutputTokens: 256` เพราะ Gemini 3.x คิดก่อนตอบ 16 token ได้คำตอบว่าง) งาน document แนบ PNG 1×1 เพื่อพิสูจน์ว่ารับรูปได้ · แสดง ✅/❌ + ms + error
- [x] สถานะปัจจุบัน: provider/model ที่มีผลจริง · แก้ล่าสุดโดยใคร (resolve display_name ฝั่ง server เพราะ profiles RLS อ่านได้แค่ตัวเอง) เมื่อไหร่ · "มีผลภายใน 1 นาที"
- [x] Tailwind v4 + shadcn/ui (Select/Table/Badge/Button/Skeleton) ใน `AppShell` · i18n 42 key ครบสองภาษา EN เขียนเป็นภาษาคน
- [x] host ของแต่ละ provider แสดงใต้ชื่อ (เพื่อเห็นว่าใช้ gateway หรือ vendor ตรง)

## 1.1.7 บันทึกเหตุการณ์ AI — ตัวช่วยที่จะได้ใช้ทุกวัน

ตอน quota เต็ม ต้องรู้ให้ได้ว่าเต็มตอนไหนและเจ้าไหน

- [x] ตาราง `ai_events` (`b28c373`): `provider`, `task`, `status` (ok / fallback / error), `error_code`, `message`, `created_at` + index · admin อ่านได้อย่างเดียว **ไม่มี write policy เลย** server เขียนผ่าน service role — ต้องทำในรอบ 1.1.3 เพราะ runtime guard ต้องเขียนลงตารางนี้
- [x] log ตอน fallback และ error เท่านั้น (primary พัง / fallback ไม่มี key / fallback พังซ้ำ / guard) **ไม่ log ตอนสำเร็จ** (`18c27e7`)
- [x] หน้า Admin แสดง 50 รายการล่าสุด (`listAiEvents` → ตารางท้ายหน้า) (`c7956af`)
- [ ] เพิ่มงานลบ event เก่ากว่า 30 วัน เข้าไปใน cron ของขั้น 1.3

## 1.1.8 ทดสอบ ✅ (2026-09-13/14 ใช้ admin/member ชั่วคราว ลบแล้ว)

- [x] admin เปลี่ยน model แล้วมีผลทันทีโดยไม่ deploy — **เคสจริง**: 3.7-flash 429 → เปลี่ยน chat เป็น 3.6-flash ผ่าน UI → แชทตอบใน 5.8 วิ
- [x] เปลี่ยน model ของ `document` → ปุ่มทดสอบยิงรูปจริง ✅ บน 3.6-flash (พิสูจน์ routing ด้วย override ปลอม → ai_events บันทึกชื่อ model ปลอมจาก production ตอน 1.1.3)
- [x] member เข้า `/admin` → redirect `/today` · ไม่มีเมนู · เรียก server fn ตรง → `Forbidden: admin only`
- [x] provider ไม่มี key → Select disable + ชื่อ env · server ปฏิเสธ `OPENAI_API_KEY is not set` (ทดสอบตอน 1.1.3)
- [x] key ผิดจริง (`ANTHROPIC_API_KEY=invalid`, primary anthropic, fallback google) → `401 API key is invalid → retried on "google"` → แชทตอบ · แถว `fallback` ใน ai_events และแสดงในตาราง
- [x] **หลัง deploy `getAiConfig`/`updateAiSettings`/`testAiModel`/`listAiEvents` อยู่ใน production bundle** — grep `dist/server` เจอ 3 ไฟล์ (เดิม 0) และเปิด `/admin` บน production ด้วย admin ชั่วคราวได้ข้อมูลจริง
- [x] console บน production ไม่มี error ใหม่ (warning "state update on unmounted component" ที่เห็นใน dev เป็น artifact ของ HMR — bisect แล้ว ไม่เกิดบน server ที่ start ใหม่และไม่เกิดบน production)

> **พบบน production ระหว่างทดสอบ — ต้องรู้ก่อนตั้ง fallback:**
> - Netlify **AI Gateway** เปิดอยู่: `ANTHROPIC_BASE_URL` และ `OPENAI_BASE_URL` ชี้มาที่ `lavieos.netlify.app` เอง พร้อม token ของ gateway (ไม่ใช่ key ของ vendor)
> - ผ่าน gateway นี้ **OpenAI ใช้ได้จริง** — `gpt-5.6-luna` ตอบใน ~800 ms (provider ที่เคยติดป้าย UNTESTED)
> - แต่ **Anthropic ผ่าน gateway ตอบ `404 Not Found` ใน 59 ms** ทุกรุ่น และ `/models` ของ gateway ตอบ `400 Invalid Content-Type` (ไม่รองรับ GET) → รายการ Anthropic/OpenAI บน production เป็น "รายการในโค้ด" ถาวรตราบใดที่ยังใช้ gateway
> - **ผลคือ `AI_FALLBACK_PROVIDER=anthropic` บน production ไม่เคยทำงานได้** — ควรเปลี่ยน fallback เป็น `openai` ผ่านหน้า Admin (หรือใส่ ANTHROPIC key จริงและถอด gateway ออกจาก Anthropic)
---

# 1.2 Data integrity & deletion path

ปัญหาที่ยืนยันแล้วตอน Phase 0: **ไม่มีคอลัมน์ไหนมี FK ไป `auth.users` เลย และไม่มี `ON DELETE CASCADE`**

หลักฐานที่เจอจริง: ลบ user ออกจาก `auth.users` แล้ว `profiles`, `user_roles`, `documents`, `reminders`, `expenses` ยังอยู่ครบ และเจอไฟล์ใน storage 3 ไฟล์ที่ไม่มีแถวใน `documents` คู่กัน (อัปโหลดสำเร็จแต่ AI ล้มเหลว ระบบไม่เขียน row และไม่มีอะไรลบไฟล์)

> ## ⚠️ ตั้งแต่ 2026-09-13 มีผู้ใช้จริงบน production แล้ว
>
> SSO จาก Aivora Hub เปิดใช้แล้ว (ดูหัวข้อ **SSO — Aivora Hub** ท้ายเอกสาร) และมีผู้ใช้จริงล็อกอินผ่านมาแล้ว
> **DB นี้ไม่ใช่ sandbox อีกต่อไป** กฎสำหรับทุกงานใน 1.2:
>
> 1. **สำรองข้อมูลก่อนรัน migration ทุกครั้ง** — Dashboard → Database → Backups (หรือ `pg_dump` ผ่าน connection string) และจดไว้ว่าสำรองเมื่อไหร่ ก่อน `supabase db push`
> 2. **ห้ามล้าง DB แบบรวบยอด** — ไม่มี `TRUNCATE`, ไม่มี `DELETE FROM x` โดยไม่มี `WHERE`, ไม่มี "ลบทุก user ยกเว้น…" การลบข้อมูลทดสอบ**ต้องระบุเป็นรายบัญชี** ด้วย uuid หรืออีเมลที่ยืนยันแล้วว่าเป็นบัญชีทดสอบ เหมือนที่ทำตอนปิด Phase 0
> 3. บัญชีที่**ห้ามแตะ**: `geeravut@gmail.com` (เจ้าของ) และผู้ใช้ทุกคนที่มีแถวใน `aivora_links` (มาจาก hub จริง)
> 4. ล้าง orphan (ข้อแรกของขอบเขต) ต้อง**ลิสต์แถวที่จะลบออกมาดูก่อน** แล้วค่อยลบ ไม่ใช่ `DELETE … WHERE NOT EXISTS` ทีเดียว

ขอบเขต:
- [x] ล้าง orphan ที่มีอยู่ก่อน — สำรวจ 2026-09-14: orphan แถว = **0** ทุกตาราง จึงไม่ต้องลบแถวใด · ไฟล์กำพร้า 1 ไฟล์ลบผ่าน Storage API หลังพี่สำรอง (`backups/20260914-053550`)
- [x] เติม FK + `ON DELETE CASCADE` ทุกตารางที่อ้าง user — migration `20260914120000_data_integrity.sql` apply แล้ว: FK → `auth.users` 15 ตัว (CASCADE; `ai_settings.updated_by` SET NULL) · ซ่อม `incomes.family_id`/`source_document_id` → SET NULL · default วันที่ไทย · `documents.kind` ใหม่ + CHECK บน `status` เดิม (คอลัมน์ `status` มีอยู่แล้วตั้งแต่ migration แรก — สำรวจรอบแรกพลาด push ครั้งแรก rollback ทั้งไฟล์แล้วแก้) · `aivora_links` มี CASCADE อยู่แล้ว
- [x] ลบไฟล์ใน storage เมื่อลบ document (มีอยู่แล้วใน docs.tsx) / ลบบัญชี (`account.server.ts` ลบผ่าน Storage API ก่อน `deleteUser`) (`ca7665f`)
- [x] อัปโหลดสำเร็จแต่ประมวลผลล้มเหลว — `doc-intake.ts` เปลี่ยนเป็น insert `pending` → upload → analyze → `ready`/`failed` · upload พังลบแถว · analyze พังเก็บแถว `failed` + ไฟล์ + ปุ่มลองใหม่ในหน้า Docs · ทดสอบ 3 เส้นทางแล้ว ไฟล์:แถว = 1:1 (`39c34b6`)
- [x] flow ลบบัญชีของผู้ใช้เอง + audit log — การ์ดใน Settings แสดง preview จากข้อมูลจริง + คำเตือนครอบครัว · พิมพ์ "ลบบัญชี"/"DELETE" (server ตรวจซ้ำ) · reset `is_shared`/`family_id` ของสมาชิกอื่นก่อน · ลบไฟล์ → audit row ใน `account_deletions` (migration `20260914150000`) → `deleteUser` → CASCADE (`ca7665f`)
- [ ] **⚠️ โอนความเป็นเจ้าของครอบครัว หรือบล็อกการลบบัญชีจนกว่าจะโอน — ต้องทำก่อนที่จะมีครอบครัวจริงที่มีสมาชิกหลายคน** — migration รอบนี้ตั้ง `families.owner_id ON DELETE CASCADE` (ตัดสินใจ 2026-09-14) แปลว่าเจ้าของลบบัญชี = ครอบครัวสลาย: `family_members` ทุกคนถูกลบ ของที่สมาชิกอื่นแชร์ไว้กลับเป็นส่วนตัว (`family_id → NULL` ข้อมูลไม่หาย) **โดยที่พวกเขาไม่รู้ตัว** วันนี้ยังไม่มีครอบครัวจริงบน production จึงยอมรับได้ แต่ flow ลบบัญชี (ข้อบน) ต้องมีอย่างใดอย่างหนึ่ง: (ก) หน้าโอน owner ให้สมาชิกคนอื่นก่อนลบ หรือ (ข) ปฏิเสธการลบถ้ายังเป็น owner ของครอบครัวที่มีสมาชิกมากกว่า 1 พร้อมบอกเหตุผล

งานที่ **1.9** ฝากมาไว้รอบนี้ (เพราะเป็นรอบที่ตัดสินเรื่อง FK ทั้งระบบ):
- [ ] **ซ่อม `incomes.source_document_id`** — ตอนนี้ `REFERENCES documents(id)` โดย**ไม่มี ON DELETE** (= NO ACTION) ต่างจาก `reminders`/`expenses` ที่เป็น `SET NULL` → ลบเอกสารที่มี income อ้างถึงจะ error ต้องเปลี่ยนเป็น `SET NULL` ให้สม่ำเสมอ
- [ ] ตัดสินใจ design ของแนบไฟล์ (1.9 ทางที่ 1 หรือ 2) **ในรอบนี้** แล้วค่อยเขียนโค้ดที่ 1.9
- [ ] คำถามเชิง schema จาก 1.8 ที่รอตอบในรอบนี้ (ดู 1.8)

**สถานะ 2026-09-14:** migration apply แล้ว · **ทดสอบ CASCADE ด้วย user ชั่วคราว 2 คน (A เจ้าของครอบครัว, B สมาชิก) ผ่านตามที่ทำนายทุกข้อ:** ลบ A → 13 ตารางของ A เหลือ 0 · ครอบครัวสลาย B หลุดจาก family_members · เอกสารที่ B แชร์ยังอยู่ `family_id → NULL` · งานของ B ยังอยู่ `assigned_helper_id → NULL` · รีวิวบนงานนั้นหายตาม helper · **ไฟล์ของ A ใน storage ยังอยู่** (ยืนยันว่า flow ลบบัญชีต้องลบไฟล์ผ่าน API เอง) · ผู้ใช้จริง 3 คนตรงกับ backup ทุกตาราง

---

# 1.3 Scheduler + LINE notification + Recurring reminder

สามงานนี้ใช้ cron runner ตัวเดียวกัน — สร้าง runner ก่อนด้วยงานที่ง่ายที่สุด (ล้าง) แล้วค่อยเสียบ engine กับ LINE

## ที่ตัดสินใจแล้ว (รอบสำรวจ 2026-09-14 — ทุกข้อจากเอกสารทางการ ไม่เดา)

- [x] **Scheduler = Netlify Scheduled Function** `netlify/functions/tick.mts` ทุก 5 นาที (cron เป็น UTC) — พิสูจน์แล้ว `f28ae4b`: deploy ร่วมกับ `server` ของ vite plugin ได้ `function_schedules` ขึ้นใน deploy API และ log `[tick] alive` ขึ้นตามเวลา (ดูด้วย `netlify logs --url https://lavieos.netlify.app` หรือหน้า Functions ใน UI)
  - ทำไมไม่ใช่ `pg_cron` + `pg_net`: งานทั้งสามต้องยิง HTTP ออก (LINE) และลบไฟล์ผ่าน Storage API ซึ่งเป็นโค้ด Node ที่มีโครงอยู่แล้ว · `pg_net` timeout default 2 วิ, response เก็บ 6 ชม., secret ต้องไปอยู่ใน Postgres · free project ของ Supabase ถูก pause ได้ถ้าเงียบ 7 วัน = cron ตายเงียบ · ทดสอบ pg_cron ในเครื่องต้อง Docker ซึ่งไม่มี
  - ราคาที่จ่าย: **30 วินาทีต่อ tick** (free plan ไม่มี background function) → ทุกงานเป็น batch เล็ก + idempotent · ทดสอบในเครื่องทำได้แค่ `netlify functions:invoke tick` (Netlify Dev ไม่รันตาม schedule)
- [x] **LINE: Life OS ผูกบัญชีเอง ด้วย LINE Login channel ของตัวเองใต้ provider `Aivora Launcher`** (ตัดสินใจ 2026-09-14 แทนแบบ "hub ส่ง `line_user_id`" — ผู้ใช้ที่ล็อกอิน Google ในเบราว์เซอร์ไม่มี LINE id ให้ hub ส่ง) · **ไม่ต้องแก้ hub**
  - หลักฐานว่า id ใช้ข้าม channel ได้ (เอกสาร Messaging API "Getting user IDs"): *"If the provider is the same, the user ID is the same regardless of the channel type (LINE Login channel or Messaging API channel)"* · `sub` ใน ID token = *"User ID for which the ID token is generated"* · รูปแบบ `U[0-9a-f]{32}`
  - flow (server route ทั้งหมด): Settings กด "เชื่อมต่อ LINE" → `/line/connect` สร้าง `state` ผูก user (แถวหมดอายุ 10 นาที) → `access.line.me/oauth2/v2.1/authorize` scope `openid profile` + **`bot_prompt=aggressive`** (ชวนเพิ่ม OA เป็นเพื่อนในจอเดียวกัน ต้องตั้ง Linked LINE Official Account ที่ channel) → `/line/callback` ตรวจ state → `POST /oauth2/v2.1/token` → `POST /oauth2/v2.1/verify` (ห้าม trust id_token จาก client) → `sub` → upsert `line_links` · ตอน callback อ่าน `friendship_status_changed` และ `GET api.line.me/friendship/v1/status` (user token) → `friendFlag`
  - ตาราง **`line_links`** ใหม่ (`user_id` PK CASCADE, `line_user_id` UNIQUE CHECK รูปแบบ, `is_friend`, `friend_checked_at`, `linked_at`, `blocked_at`) + `line_link_states` — ไม่ใช้ `aivora_links` (มีเฉพาะคน SSO) ไม่ใช้ `profiles` (ผู้ใช้เขียนเองได้ตาม RLS) · เขียนเฉพาะ service role
  - ก่อน push ทุกครั้ง: `GET /v2/bot/profile/{userId}` ด้วย channel token — 200 = เพื่อน, **404** = ยังไม่เพิ่ม/บล็อก → mark `is_friend=false` ไม่ยิง · push ถึงคนบล็อก/ไม่ได้เพิ่ม **ได้ 200 แต่ไม่ถึงและไม่นับโควตา** (เอกสาร push + pricing) — การเช็คมีไว้เพื่อบอกผู้ใช้ ไม่ใช่ประหยัดโควตา
  - token: channel access token แบบ **long-lived** (indefinite, มีเฉพาะ Messaging API channel) เก็บเป็น Netlify env `LINE_CHANNEL_ACCESS_TOKEN` ห้ามมี prefix `VITE_`
  - สิ่งที่พี่ต้องกดใน console.line.biz: provider Aivora Launcher → Create channel → **LINE Login** (Web app) → Basic settings: Channel ID/secret → Netlify env `LINE_LOGIN_CHANNEL_ID`/`LINE_LOGIN_CHANNEL_SECRET` · Linked LINE Official Account → เลือก OA · แท็บ LINE Login → Callback URL `https://lavieos.netlify.app/line/callback` · คง **Developing** จนทดสอบผ่าน (Admin/Tester เท่านั้นที่ล็อกอินได้) แล้วกด Published (ย้อนไม่ได้) · OA: issue channel access token long-lived
  - ยังไม่ยืนยัน: console รับ `http://localhost` เป็น callback ไหม (ดูตอนกรอก)
  - ผู้ใช้ที่ไม่ผูก LINE → **in-app เท่านั้น** (`notification_log.channel = 'none'`) ไม่ส่งอีเมล (SMTP ของ Supabase มีไว้ auth เท่านั้น)
  - **รูปแบบข้อความ = Flex Message** ไม่ใช่ text — อ้างอิงการ์ดของ WelCares: header แถบสี + ไอคอน + หัวข้อ, body เป็นแถว label–value · `altText` ต้องสื่อความจริง (คือสิ่งที่เห็นในแถบแจ้งเตือนและเครื่องที่แสดง Flex ไม่ได้) ห้ามใส่แค่ "แจ้งเตือน" · **ปุ่ม** เปิดหน้าที่เกี่ยวข้องตรง ๆ แทนข้อความบอกทาง — ตรวจว่าใช้ LIFF URL ได้ไหมจะได้เปิดในแอป LINE ไม่เด้งเบราว์เซอร์ · ข้อความไทย `wrap: true` ทดสอบจอแคบจริง · `immediate` = การ์ดเดียวเรื่องเดียว · `digest` = การ์ดเดียวหลายรายการ (หรือ carousel) — นับ 1 หน่วยเท่ากัน · วันที่เป็น พ.ศ. เหมือนในแอป · **ทดสอบบนเครื่องจริง iOS + Android ก่อนถือว่าเสร็จ** — Flex ที่ดูดีในเอกสารมักเพี้ยนบนจอจริง
- [x] **โควตา OA 300 ข้อความ/เดือน → LINE มี 2 โหมด**: `immediate` ส่งทันทีเฉพาะ `priority = 'high'` · `digest` สรุปวันละครั้งต่อผู้ใช้สำหรับที่เหลือ · เมื่อใกล้เต็ม หยุด digest ก่อน เก็บที่เหลือให้ immediate
  - นับโควตาจาก `notification_log` (`channel='line' AND status='sent'` ในเดือนนี้ มี partial index) — ไม่มีตารางตัวนับแยก เพราะ log คือ ledger อยู่แล้ว ตัวนับแยกต้อง update ซ้ำทุกครั้งที่ส่ง + reset รายเดือน = state ที่เพี้ยนได้ · ตัวเลขทางการคือ `GET /v2/bot/message/quota/consumption` ของ LINE (`totalUsage` อาจอัปเดตช้า) tick อ่านครั้งเดียวต่อรอบ เก็บใน `cron_ticks.summary` แล้วใช้ค่าที่**มากกว่า**ระหว่างสองแหล่งตัดสิน · retention ของ `notification_log` ต้อง ≥ 2 เดือน (ตั้ง 90 วัน)
  - ยืนยันจากหน้า pricing แล้ว: *"The number of messages is counted by the number of people you send a message to ... The number of message objects in a request doesn't affect the number of messages sent."* · นับ push/multicast/broadcast **reply ไม่นับ** · ส่งถึงคนบล็อก/ไม่มีตัวตน ไม่นับ
- [x] **Recurring: แจ้งเตือน ≠ จัดการเสร็จ** (ตัดสินใจ 2026-09-14 แทน "เลื่อนงวดตอนแจ้ง" — ถ้าเลื่อนทันทีที่แจ้ง reminder จะไม่มีวันปรากฏในแถบ "ถึงกำหนดแล้วแต่ยังไม่ได้จัดการ" ทั้งที่ยังไม่ได้จ่าย) · tick แค่ claim + log แถวคง open และโชว์ "เลยกำหนด" · **กด "ทำเสร็จ — เลื่อนไปเดือนหน้า/ปีหน้า"** ถึงเลื่อน `due_at` ไปงวดถัดไปหลังตอนนี้ (คำนวณเวลาไทย clamp วัน) reset claim บันทึก `last_completed_at` คง open · **ตาข่าย `rolloverStale`**: ครบ 1 งวดเต็มยังไม่กด → tick เลื่อนให้เองไปงวดล่าสุด ≤ ตอนนี้แล้วแจ้งใหม่ — คนที่อ่านแค่ LINE ไม่เงียบหายถาวร
  - ขอบเดือน (รันจริง): 31 ม.ค.+1 → 28 ก.พ. (29 ปีอธิกสุรทิน) · 29 ก.พ.+1 ปี → 28 ก.พ. · ค้าง 3 เดือนแล้วกด done → งวดเดียวถัดไป ไม่ยิงย้อน
  - **ค้างในแผน — drift ข้ามการเลื่อน**: พอ 31 ม.ค. ตกไป 28 ก.พ. แล้ว งวดถัดไปคือ 28 มี.ค. ไม่กลับไป 31 คนตั้งเตือนสิ้นเดือนผ่านไปปีหนึ่งวันจะเลื่อนไปเรื่อย ๆ · แก้ได้ต้องมีคอลัมน์เก็บวัน anchor (เช่น `recurrence_day`) ไม่ด่วน
  - **rescheduling = งวดใหม่** (3.2): trigger `trg_reminders_reset_claim` BEFORE UPDATE OF `due_at`,`notify_at` reset `notified_at/notify_attempts/notify_error` เมื่อค่าเปลี่ยนจริง · อาการที่กันคือ **หายเงียบ** (claim ผูกกับ `notified_at` ไม่ใช่ `due_at` เลื่อนแล้วจะไม่ถูกแจ้งเลย) ไม่ใช่ยิงซ้ำอย่างที่รอบสำรวจเขียน · เลือก trigger เพราะไม่มี update path เดียว (เบราว์เซอร์เขียนตรงผ่าน RLS, chat action, doc-intake, LINE ในอนาคต, SQL editor)
- [x] `notification_log` **ไม่มี FK** ไปยัง `reminders`/`auth.users` (แบบเดียวกับ `account_deletions`) เพราะเป็น ledger ที่ตัวนับโควตาพึ่ง — แถวต้องอยู่รอดแม้ reminder หรือบัญชีถูกลบ ผู้อ่านต้อง LEFT JOIN · retention 90 วันเป็นทางเดียวที่ลบ
- [x] **กันส่งซ้ำ 3 ชั้น**: (1) claim `UPDATE reminders SET notified_at = now() WHERE id = $1 AND notified_at IS NULL RETURNING` (2) partial unique ใน `notification_log` — `(reminder_id, due_at) WHERE kind='immediate'` และ `(user_id, digest_date) WHERE kind='digest'` (3) `cron_ticks (job, tick)` PK = lock ต่อนาที กัน Netlify ยิงซ้อน/Run now
- [x] **retry**: 3 ครั้ง ห่างกันตาม tick เฉพาะ 5xx/timeout · 4xx ไม่ retry (token ผิด → หยุดทั้งระบบ + แจ้ง, ผู้ใช้บล็อก/ไม่ follow → mark)
- [x] **งานล้าง**: `ai_events` > 30 วัน · `documents` failed > 30 วัน (badge บอกวันลบในหน้า Docs) · pending > 1 ชม. (แท็บปิดกลางทาง) — ทั้งสองลบไฟล์ผ่าน Storage API **ก่อน** ลบแถว · `notification_log` > 90 วัน · `cron_ticks` > 30 วัน · `account_deletions` ไม่ลบ

## ลำดับทำ

- [x] 0 — scheduled function เปล่า พิสูจน์ schedule + log `f28ae4b`
- [x] 1 — migration `ecefaa2` (applied 2026-09-14): คอลัมน์ใน `reminders` (`notify_at, notified_at, notify_attempts, notify_error, last_completed_at`) + CHECK `recurrence` + `notification_log` (2 โหมด, ไม่มี FK) + `cron_ticks`
- [x] 2 — งานล้างใน tick `0f5cfdb`: `src/lib/cron.server.ts` (`runTick`) — lock `cron_ticks`, ai_events > 30 วัน, failed docs > 30 วัน, pending > 1 ชม. (ลบไฟล์ก่อนแถว, ≤ 20 แถว/รอบ), notification_log > 90 วัน, cron_ticks > 30 วัน, งบเวลา 24 วิ · ค่า retention อยู่ที่ `src/lib/retention.ts` ที่เดียว (badge "จะถูกลบใน N วัน" ในหน้า Docs อ่านจากที่เดียวกัน) · ทดสอบ: `npx tsx scripts/run-tick.ts [ISO-minute]` ยิงตรง DB — พิสูจน์แล้วกับข้อมูลที่สร้างมาลบ: ลบถูกชุด (5 docs → เหลือ 3, events 3 → 1), นาทีเดียวกันซ้ำ = skip, แถว failed ที่ไฟล์หายแล้วถูกลบได้, invariant ไฟล์↔แถว 1:1 หลังทุกรอบ · run log อ่านจาก `cron_ticks` (`summary` jsonb)
- [x] 3 — recurring engine `80ef35d` + done/แถบ Today `b02b6cb` + trigger `c03ebe8` (applied 2026-09-14): claim atomic, `notification_log` `channel='none'` (`immediate` สำหรับ high, `digest` ต่อ user ต่อวันไทย append `reminder_ids`), rollover, ปุ่ม done บอกพฤติกรรมก่อนกด, Today แสดง "ถึงกำหนดแล้ว" + badge "เลยกำหนด" (ก่อนวันนี้ไทย) · ทดสอบ: 2 tick พร้อมกัน claim รวม = จำนวนที่ถึงกำหนดพอดี ไม่ซ้ำ · rollover เฉพาะที่ครบงวด · UI TH/EN ใน dev server · trigger: unrelated update/ค่าเดิม ไม่ reset, เลื่อนจริง reset แล้ว tick แจ้งใหม่ครั้งเดียว
- [x] 4a — ผูกบัญชี LINE `7cfee11` + `f6e0f8f` (applied 2026-09-14): `line_links`/`line_link_states` · `src/lib/line-link.server.ts` (`startLink` state 32 bytes ผูก user 10 นาที + `bot_prompt=aggressive` · `finishLink` consume state ต้องเป็นของผู้เรียก → token → **verify กับ LINE** → `friendship/v1/status` ด้วย user token → revoke → upsert) · server fn 4 ตัวหลัง auth · หน้า `/line/callback` (page + server fn เพราะ session อยู่ใน localStorage ไม่ใช่ cookie) · การ์ดใน Settings 3 สถานะ (ยังไม่เชื่อม / เพื่อนแล้ว / **ยังไม่เพิ่มเพื่อน = กล่องแดง "จะยังไม่ได้รับการแจ้งเตือน" + ปุ่มเพิ่มเพื่อน + ตรวจสอบอีกครั้ง**) + ยกเลิกการเชื่อมต่อ · env: `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET`, `LINE_OA_ADD_FRIEND_URL` · ทดสอบด้วย fake LINE (patch fetch): bad origin, state ปลอม/ของคนอื่น/หมดอายุ ล้มก่อนแตะ LINE, code ผิด, ผูกสำเร็จ, **LINE id เดิมกับ user ที่สอง → `line_id_in_use` ข้อความอ่านรู้เรื่อง user แรกไม่ถูกแตะ**, **เชื่อมซ้ำ = อัปเดตสถานะเพื่อน `linked_at` คงเดิม**, unlink, states เหลือ 0 · UI ทดสอบใน dev · **ทดสอบ LINE จริงโดยเจ้าของ: รอผล**
  - ปุ่ม "ตรวจสอบอีกครั้ง" ใช้ `GET /v2/bot/profile/{userId}` ด้วย `LINE_CHANNEL_ACCESS_TOKEN` แล้ว (4b) — ไม่ผ่าน consent อีก
- [x] 4b — ส่งข้อความจริง `c288d3c` (migration `notification_settings`) + `a14de34`: `line-flex.ts` (การ์ด immediate/digest ตาม note: header สีแบรนด์ + แถว label–value + ปุ่ม uri จริง + `wrap:true` ทุก text + altText มีเนื้อหาจริง + วันที่ พ.ศ. · digest ≤ 8 แถว + "และอีก N เรื่อง") · `line-push.server.ts` (profile / push + `X-Line-Retry-Key` / quota / validate) · `line-deliver.server.ts` (ขั้น `deliverQueued` ใน tick: immediate ส่งทันที, digest ส่งตั้งแต่ `line_digest_hour`; retry 3 เฉพาะ 5xx/timeout/network/429-rate; 401/403 → `haltLine` 6 ชม. + ai_events `auth_failed`; 400 → failed + `blocked_at`; 429 monthly → skipped + ai_events; 409 = LINE รับไปแล้ว นับ sent) · `claimForDigest` claim เรื่องไม่เร่งที่ due วันนี้ทั้งวันเข้าสรุปเช้าของคนที่มี LINE · **quota guard** `used = max(นับจาก notification_log ตั้งแต่ต้นเดือน**ไทย**, LINE totalUsage)` digest หยุดที่ `cap − reserve`, immediate หยุดที่ `cap` · Admin card: แถบใช้ไป, ตัวเลขทั้งสองแหล่ง, แก้ cap/reserve/hour, ปุ่ม resume · ทดสอบ fake LINE 27 กรณี (รวม halt→ไม่มีอะไรหลุดแม้ immediate→resume, ข้ามเที่ยงคืนไทย 23:58/00:03 = คนละ digest_date, ข้ามเดือน 00:30Z วันที่ 1 = เดือนใหม่) · ส่งจริง 2 ข้อความ (immediate + digest) ให้เจ้าของดู iOS/Android
  - ยังไม่ได้ทำ: **LIFF** — ปุ่มบนการ์ดเปิด `https://lavieos.netlify.app/today` (เบราว์เซอร์ในตัวของ LINE) · เมื่อสร้าง LIFF app แล้วใส่ env `LINE_LIFF_ID` ปุ่มจะเปลี่ยนเป็น `https://liff.line.me/{id}/today` เอง (โค้ดรองรับแล้ว) → งานเล็กใน 1.5
  - digest ยังไม่รวม "ค้างจากวันก่อน" (เฉพาะเรื่องที่ due วันนั้น) — ถ้าต้องการ nag รายวันเป็นงานถัดไป
- [ ] ลบ `ai_events` เก่ากว่า 30 วัน (ค้างจาก 1.1.7) → อยู่ในข้อ 2

---

# 1.4 Payment rails

- [ ] เลือก payment gateway ที่มีใบอนุญาต (Omise / GB Prime Pay / 2C2P / SCB)
- [ ] PromptPay QR + ผ่อนชำระ
- [ ] Admin ตั้งค่า commission / service fee ได้ (`platform_settings` มีคอลัมน์อยู่แล้ว แต่ยังไม่มี UI)
- [ ] Escrow-ready สำหรับ Task Marketplace

> **ต้องรู้ก่อนเริ่ม:** การเก็บเงินแล้วโอนต่อให้ผู้ให้บริการ เข้าข่ายธุรกิจบริการการชำระเงินภายใต้การกำกับของ ธปท. ควรปรึกษาที่ปรึกษากฎหมายก่อนเปิดใช้จริง

---

# 1.5 งานค้างจาก Phase 0

- [ ] **LIFF สำหรับปุ่มบนการ์ด LINE** (จาก 1.3/4b): LINE Login channel ของ Life OS → แท็บ LIFF → Add (Size Full, Endpoint `https://lavieos.netlify.app`, Scope `openid`) → ได้ LIFF ID → Netlify env `LINE_LIFF_ID` → ปุ่มจะเปิดในแอป LINE ไม่เด้งออกเบราว์เซอร์ · ต้องเช็กว่า session ของแอปอยู่ใน LIFF browser (storage เดียวกับที่ Launcher เปิด) — ถ้าไม่ ผู้ใช้จะเจอหน้า login ครั้งแรก
- [ ] Help Me — ฟีเจอร์ให้คะแนน (ตาราง `job_reviews` มีอยู่แล้ว ขาดแค่ UI)
- [ ] `createServerFn().inputValidator()` deprecated 7 จุด ใน `lifeos.functions.ts` และ `marketplace.functions.ts` → เปลี่ยนเป็น `.validator()`
- [ ] bundle หลัก 600 kB เกินเกณฑ์เตือน — พิจารณา code splitting

---

# 1.6 i18n — บังคับให้ครบสองภาษาตอน build ✅

**สถานะ: ทำแล้ว `777f553`** (ทำก่อน 1.1 ตามลำดับที่ตกลง)

## ที่พบตอนสำรวจ (2026-09-12)

- คำแปลทั้งหมดอยู่ใน object เดียวใน `src/lib/i18n.tsx` — 215 key ต่อภาษา ตรงกันพอดี ณ ตอนนั้น **ด้วยวินัย ไม่ใช่ระบบ**
- `Dict = (typeof dict)["th"]` → ไทยเป็นภาษาแม่ · แต่บรรทัด `t: dict[lang] as Dict` **ปิดปาก TypeScript** — พิสูจน์ด้วย probe: ลบ key ออกจาก `en` แล้ว `tsc --strict` **ผ่าน** ถ้าไม่มี cast จะ error ทันที → runtime `t.xxx` เป็น `undefined` render ช่องว่างเงียบ ๆ
- `"build": "vite build"` **ไม่ typecheck** — ต่อให้ type จับได้ Netlify ก็ deploy โค้ดที่มี TS error ได้ (esbuild แค่ strip type)
- dict มี **2 key ที่เป็นฟังก์ชัน** (`todayCount`, `feeNote`) — `Record<keyof typeof th, string>` ตรง ๆ ใช้ไม่ได้

## ที่ทำไป

- `th … as const` → `type Dict = { [K in keyof typeof th]: (typeof th)[K] extends string ? string : (typeof th)[K] }` (widen literal เป็น `string` แต่คง signature ฟังก์ชัน) → `en … satisfies Dict` → ลบ `as Dict` ทิ้ง
- `"build": "tsc --noEmit && vite build"` — Netlify build ช้าขึ้น ~10 วิ และ **TS error ทุกชนิดจะทำให้ deploy ล้ม** ตั้งใจ · ก่อน push ควร `npx tsc --noEmit` ทุกครั้ง
- พิสูจน์: ลบ `en.familyLoadError` → `error TS1360 … Property 'familyLoadError' is missing` exit 2 · ใส่กลับ exit 0

## ที่ยังไม่ครอบคลุม → ทำใน 1.7

ข้อความที่**อยู่นอก dict** ระบบนี้ตรวจไม่ถึง:
- `lang === "en" ? "…" : "…"` ฝังในโค้ด **12 จุด ใน 8 ไฟล์**: `docs.tsx`, `settings.tsx`, `benefits.tsx`, `BenefitChatCards.tsx`, `phum.server.ts` ×4, `marketplace.server.ts` ×2, `ai-gateway.server.ts`, `benefits.ts`
- `<title>` / og:description ของทุก route **ไทยล้วน 12 จุด** ไม่สลับภาษา
- `catLabel()` ถ้าหมวดไม่มีในตาราง **โชว์ key ดิบ** (`categoryLabels[k]?.[lang] ?? k`)
- `benefits.ts` มี dict รองรูป `{ th: string; en: string }` 30 รายการ — รูปนี้**ปลอดภัยอยู่แล้ว** (type บังคับทั้งคู่) ไม่ต้องแตะ

## ทางเลือกที่ไม่ได้เลือก (เก็บไว้เผื่อ)

สคริปต์เทียบ `Object.keys(th)` กับ `Object.keys(en)` รันใน `prebuild` — ขยายไป grep inline string ได้ แต่ error โผล่ตอน build เท่านั้น ไม่ขึ้นใน editor และต้อง**แยก dict ออกจาก `i18n.tsx`** เป็น `.ts` ธรรมดาก่อน (ไฟล์ปัจจุบันมี React import) — ใช้เฉพาะถ้าอยากไล่จับ inline string ด้วยเครื่องจักร ซึ่งย้ายเข้า dict ให้หมดใน 1.7 ง่ายกว่า

---

# 1.7 เปลี่ยนชื่อ "ค่าใช้จ่าย" + เก็บกวาด i18n รอบเดียว ✅ 2026-09-14

## ยืนยันแล้ว: หน้านี้เป็น "รายรับ-รายจ่าย" เต็มตัว ป้ายยังบอกว่า "ค่าใช้จ่าย"

`money.tsx` มี 2 tab (`expense` / `income`), อ่านและเขียนทั้ง `expenses` และ `incomes`, แสดง `totalIncome`/`totalExpense` แยก และ chat router มี intent `add_income`

## key ที่ต้องเปลี่ยน — **แค่ 3 key + 2 บรรทัด** ไม่ใช่ทั้งกลุ่ม

| key | ใช้ที่ | ไทย | EN ตอนนี้ | เสนอ EN |
|---|---|---|---|---|
| `navMoney` | เมนูข้าง + แถบล่างมือถือ | ค่าใช้จ่าย | Expenses | **Money** (สั้น พอดีแถบล่าง 5 ช่อง) |
| `moneyTitle` | H1 หน้าเงิน, การ์ด landing, หัวข้อในหน้า Family | บิลและค่าใช้จ่าย | Bills & money | **Income & expenses** |
| `routedToExpense` | toast ตอนเอกสารถูกส่งไปหน้าเงิน | เพิ่มในค่าใช้จ่ายแล้ว | Added to Expenses | ให้**ตรงกับชื่อใหม่ของ tab** ไม่งั้นผู้ใช้หา "ค่าใช้จ่าย" ไม่เจอ |
| `<title>` + og ใน `money.tsx:28,30` | tab เบราว์เซอร์ | บิลและค่าใช้จ่าย | (ไทยล้วน) | แก้คู่กัน — เป็น 1 ใน 12 จุดนอก dict |

- [x] เปลี่ยน 3 key: `navMoney` → "รายรับ-รายจ่าย"/"Money" · `moneyTitle` → "รายรับ-รายจ่าย"/"Income & expenses" · `routedToExpense` → "เพิ่มในรายรับ-รายจ่ายแล้ว"/"Added to Income & expenses" · title/og ของ money.tsx ย้ายเข้า dict พร้อมกัน
- [x] **ไม่เปลี่ยน** เพราะหมายถึงรายจ่ายอย่างเดียวจริง: `monthSpend` (การ์ดหน้า Today นับแค่ expenses), `tabExpense`/`tabIncome`, `addExpense`/`addIncome`, `moneyEmpty`/`incomeEmpty` (แยกตาม tab อยู่แล้ว), `totalExpense`/`totalIncome`, `heroSub`
- [x] inline `lang === "en"` — **นับใหม่ตามจริง: จาก 12 จุดที่ grep เจอ มีแค่ 2 จุดที่เป็น UI string ฮาร์ดโค้ด** (ข้อความ PDF ใน `phum.server.ts`, ไฟล์ใหญ่เกินใน `docs.tsx`) → ย้ายเข้า dict แล้ว (`docsPdfUnsupported`, `docsFileTooLarge(mb)`) · 5 จุดเป็นชื่อภาษาใน prompt AI → รวมศูนย์เป็น `langName()` · 2 จุดเลือก `{th,en}` จากข้อมูล → `localized()` · **ไม่แตะ 3 จุด**: persona AI (`ai-gateway.server.ts`), เลือก `title_en`/`title` จาก DB (`benefits.ts`), `variant` ของปุ่มภาษาใน settings (style ไม่ใช่ข้อความ)
- [x] `<title>`/og 14 route → `routeMeta(page)` อ่านจาก dict (key `meta_<page>_title` / `_desc` ครบสองภาษา) — **decision:** `<title>` สลับตามภาษาผู้ใช้ ส่วน `description`/`og:*` **คงไทยเสมอ** เพราะเป็นของ crawler ที่เห็นแค่ SSR (ไม่มี localStorage) และถ้าให้ client สลับ React จะเก็บ `<meta>` ของ SSR กับของ client ไว้คู่กัน (ทดสอบแล้วเจอ description 2 อัน) ขณะที่ `<title>` เป็น singleton อัปเดตได้สะอาด · dict แยกออกเป็น `src/lib/i18n.dict.ts` (ไม่มี React) ให้ server และ `head()` ใช้ได้
- [ ] `catLabel()` fallback: โชว์ `categoryLabels.other` แทน key ดิบ — ยังไม่ทำ (นอกขอบเขตที่สั่งรอบนี้)

---

# 1.8 เวลา — Asia/Bangkok

## ชนิดคอลัมน์จริง (ตรวจแล้ว ออกแบบถูก ไม่ต้องแก้)

| ตาราง | `date` | `timestamptz` | `created_at`/`updated_at` |
|---|---|---|---|
| expenses | `spent_on` (default `CURRENT_DATE`), `due_date` | — | ✅ |
| incomes | `received_on` (default `CURRENT_DATE`) | — | ✅ |
| reminders | — | `due_at` | ✅ |
| documents | `doc_date`, `due_date` | — | ✅ |

## Hotfix ✅ `f4f5f69` — ทำก่อนทุกอย่างเพราะเป็นบั๊กที่ผู้ใช้เจอทุกเช้า

**ก่อนแก้ ไม่มีที่ไหนในโค้ดระบุ timezone เลย** (grep `timezone|Asia/Bangkok|+07` = 0) ทุกจุดใช้ค่า default ของที่โค้ดรัน ซึ่งเบราว์เซอร์ = Bangkok แต่ Netlify Functions = UTC และ `toISOString()` = UTC เสมอแม้ในเบราว์เซอร์ → **00:00–07:00 น. ทุกวัน** ระบบคิดว่าเป็นเมื่อวาน

| จุด | อาการ | แก้เป็น |
|---|---|---|
| `phum.server.ts` ×2 — `Today is …` ใน prompt | AI anchor วันผิด 7 ชม./วัน — "เตือนพรุ่งนี้" ตอน 6 โมงเช้าได้วันนี้ · prompt สั่ง "If a date is missing, use today" → รายจ่ายลงผิดวัน | `todayInBangkok()` + prompt ระบุ `(Asia/Bangkok, UTC+07:00)` |
| `phum.server.ts` schema `dueAt` | บอกแค่ "ISO datetime" ไม่บอก TZ — AI คืนแบบไม่มี offset แล้วพึ่งโชคที่ `new Date()` รันในเบราว์เซอร์ | สั่ง `always with the +07:00 offset` — ยืนยันแล้ว AI คืน `2026-09-18T15:00:00+07:00` |
| `phum-actions.ts` `today()` fallback | UTC ในเบราว์เซอร์ | `todayInBangkok()` |
| `format.ts` `toDateInput` → ค่า default ช่องวันที่หน้าเงิน | ฟอร์มขึ้นวันเมื่อวาน | `todayInBangkok(d)` |
| `today.tsx` ยอดเดือนนี้ | `setDate(1)` local + `toISOString` UTC → วันที่ 1 ช่วง 00:00–07:00 รวมวันสิ้นเดือนก่อน | `monthStartInBangkok()` |
| `docs.tsx` reminder จากเอกสาร | `new Date("YYYY-MM-DD")` = UTC เที่ยงคืน = **07:00 ไทย** ทุกครั้ง | `bangkokDateAtHour(due_date, 9)` = 09:00 ไทย |
| `doc-intake.ts` ×2 (**สำรวจรอบแรกพลาด**) | บั๊กเดียวกันทั้งสองแบบ สำหรับ reminder/รายจ่ายอัตโนมัติจากเอกสาร | เหมือนบน |

- helper เดียวใน `src/lib/time.ts` — `"Asia/Bangkok"` ปรากฏใน `src/` **ที่นี่ที่เดียว** ไม่มี React/server import ใช้ได้ทั้งสองฝั่ง
- พิสูจน์ด้วย fake clock ในช่วงที่พังภายใต้ `TZ=UTC` และ `TZ=Asia/Bangkok` + ในแอปจริง override `Date` เป็น 03:30 น. 1 ต.ค. → ช่องวันที่ = `2026-10-01`, query ยอดเดือน = `spent_on=gte.2026-10-01`
- ที่ยัง**ถูกอยู่แล้ว** ไม่ได้แตะ: `tasks.tsx` datetime-local (ไป-กลับในเบราว์เซอร์เดียวกัน), `formatDay` (Intl ใช้ TZ เบราว์เซอร์ + `th-TH` ให้ พ.ศ. เอง)
- AI extraction: เอกสารดึง**วันล้วน** (`YYYY-MM-DD`) ถูกต้องสำหรับบิล · แชทดึง**เวลาด้วย** (`dueAt` ISO datetime)

## คำถามเชิง schema — ตอบตอน 1.2

- [ ] reminder จากเอกสารใช้ **09:00 ไทย** เป็นค่าตายตัว — พอไหม หรือควรเป็น setting ต่อผู้ใช้ / ต่อประเภทเอกสาร
- [ ] ควรมี `profiles.timezone` ไหม — ตอนนี้ hardcode Bangkok ได้เพราะแอปเป็นไทยล้วน แต่ถ้าจะรับผู้ใช้นอกไทยต้องมี และ helper ทุกตัวต้องรับ TZ เป็น parameter
- [ ] DB default `CURRENT_DATE` เป็น UTC — **ตอนนี้ไม่เคยถูกใช้** (โค้ดส่งวันชัดเจนทุกทาง) แต่เพื่อความปลอดภัยเผื่อ insert จากที่อื่น พิจารณาเปลี่ยนเป็น `(now() at time zone 'Asia/Bangkok')::date`
- [ ] คอลัมน์ `date` แสดงผลเป็น ISO ดิบ (`2026-09-30`) ในหน้าเอกสาร — UX nit ไม่ใช่บั๊ก TZ

---

# 1.9 แนบไฟล์

## ผูกกันยังไงตอนนี้ — ทางเดียว จากเอกสารลงไป

```
documents (1) ──source_document_id──▶ reminders (n)   ON DELETE SET NULL ✅
                                   ──▶ expenses  (n)   ON DELETE SET NULL ✅
                                   ──▶ incomes   (n)   ไม่ระบุ = NO ACTION ❌ (ซ่อมใน 1.2)
```

- `source_document_id` มีคนเขียน 4 จุด (`doc-intake.ts` ×3, `docs.tsx` ×1) แต่ **ไม่มีใครอ่านเลย** — ไม่มี UI โชว์ว่ารายจ่ายนี้มาจากเอกสารไหน ไม่มีปุ่มเปิดไฟล์ ลิงก์มีใน DB แต่ผู้ใช้มองไม่เห็น
- **ทิศทางกลับด้านกับสิ่งที่ "แนบไฟล์" ต้องการ**: ตอนนี้ "เอกสาร → AI แตกเป็นรายจ่าย" แต่แนบไฟล์คือ "มีรายจ่ายแล้ว → เอาใบเสร็จมาแปะ" ซึ่ง**ทำไม่ได้** เพราะทางเดียวที่ไฟล์เข้าระบบคือ `doc-intake.ts` ที่**บังคับผ่าน AI เสมอ** — อัปโหลดใบเสร็จของรายจ่ายที่มีแล้วจะได้รายจ่าย**ซ้ำ**

## ทางเลือก

### ทางที่ 1 — คอลัมน์อ้างอิงในแต่ละตาราง (ใช้ `source_document_id` ที่มีอยู่)

| ข้อดี | ข้อเสีย |
|---|---|
| เล็ก query เดียวได้ครบ · `documents` **ก็คือ attachments table อยู่แล้ว** (มี `storage_path`, `mime_type`, `user_id`, RLS ครบ) | **1 รายการ = 1 ไฟล์** (ใบเสร็จ + ใบกำกับภาษี แนบคู่ไม่ได้) |
| RLS ไม่ต้องเพิ่ม ไฟล์อยู่ใต้แถวที่ RLS คุมแล้ว | ต้องเพิ่มคอลัมน์ทุกตารางที่อยากแนบในอนาคต (jobs? benefits?) |
| ไม่แก้ schema เลยนอกจากซ่อม FK ของ incomes | logic ลบไฟล์กระจาย 3 ที่ |

### ทางที่ 2 — ตาราง `attachments` กลาง (polymorphic `target_type` + `target_id`)

| ข้อดี | ข้อเสีย |
|---|---|
| หลายไฟล์ต่อรายการ · แนบกับอะไรก็ได้โดยไม่แก้ schema เดิม | `target_id` **ใส่ FK ไม่ได้** เพราะชี้หลายตาราง → orphan ต้องล้างเอง (ปัญหาเดียวกับที่ 1.2 กำลังแก้) |
| จุดเดียวสำหรับ lifecycle ไฟล์ | RLS ซับซ้อน: อ่าน attachment ได้ต้องเช็กว่าอ่าน target ได้ (`CASE target_type` หรือ SECURITY DEFINER) |
| ตอบโจทย์ระยะยาว | งานใหญ่กว่าเท่าตัว |

**คำแนะนำ: ทางที่ 1** — ยังไม่มีหลักฐานว่าใครต้องแนบหลายไฟล์ต่อรายการ งานจริงคือ (ก) ปุ่ม "แนบใบเสร็จ" บนรายจ่าย/รายรับ/reminder (ข) ทางเข้าอัปโหลดที่**ข้าม AI** → insert `documents` แบบ `category: 'receipt'` (ค) set `source_document_id` (ง) โชว์ thumbnail/ปุ่มเปิดไฟล์บนการ์ด — และอ่านลิงก์ที่มีอยู่แล้วให้เห็นเสียที

## ทับซ้อนกับ 1.2

| 1.2 | 1.9 |
|---|---|
| "อัปโหลดสำเร็จแต่ AI ล้มเหลว ต้องไม่ทิ้งไฟล์ค้าง" | ทางเข้าใหม่ที่ข้าม AI **ต้องไม่สร้างรูรั่วแบบเดียวกัน** — upload → insert ต้อง atomic หรือมี cleanup |
| "ลบไฟล์ใน storage เมื่อลบ document" | ลบ document ที่รายจ่ายอ้างถึง → รายจ่ายต้องรู้ (`SET NULL` ✅ / incomes ❌) |
| "เติม FK + CASCADE" | **ซ่อม `incomes.source_document_id` เป็น SET NULL ในรอบเดียวกัน** |
| ถ้าเลือกทางที่ 2 | ต้องออกแบบ**พร้อม** 1.2 ไม่งั้นเป็น migration รอบสอง |

- [ ] ตัดสินใจทางที่ 1 / 2 ตอน 1.2
- [ ] ทางเข้าอัปโหลดแบบไม่ผ่าน AI (ใช้ `documents` เดิม)
- [ ] ปุ่มแนบบนการ์ดรายจ่าย/รายรับ/reminder + แสดงไฟล์ที่แนบ
- [ ] แสดง "มาจากเอกสาร X" บนรายการที่ AI สร้างให้ (อ่าน `source_document_id` ที่มีอยู่แล้ว)

---

# 1.10 เสียง

## Provider — ตรวจจากเอกสารทางการ 2026-09-12

| Provider | รับ audio ในการเรียกแชท? | STT แยก | ไทย | ราคา | แหล่ง |
|---|---|---|---|---|---|
| **Google** | ✅ `gemini-3.7-flash` รับ 13 format (wav/mp3/aac/opus/webm…) ยาวถึง 9.5 ชม. · **32 token/วินาที** (1 นาที = 1,920 token) | `gemini-3.5-transcribe` ≤1 ชม. | ✅ `th-TH` ใน 85+ ภาษา | transcribe ≈ $0.005/นาที blended · มี free tier | ai.google.dev/gemini-api/docs/audio · /models/gemini-3.5-transcribe · /pricing |
| **Anthropic** | ❌ หน้า models ระบุ "text and image input" · `/build-with-claude/audio` = 404 | ไม่มี | — | — | platform.claude.com/docs/en/about-claude/models/overview |
| **OpenAI** | ❌ chat model ปกติไม่รับ (มีแต่ `gpt-realtime` = WebSocket คนละสถาปัตยกรรม) | `gpt-transcribe` $0.0045/นาที · `gpt-4o-mini-transcribe` $0.003 · `whisper-1` $0.006 · ไฟล์ ≤25 MB | ✅ `"th": "thai"` ใน Whisper | ตามซ้าย | developers.openai.com/api/docs/guides/speech-to-text · /pricing |

**ผลกระทบเชิงสถาปัตยกรรม:** เสียงคือฟีเจอร์แรกที่ **provider 3 เจ้าไม่สลับกันได้** — ส่ง audio เข้า `withProviderFallback` แล้ว Google ล่ม fallback ไป Anthropic จะพังทันที ทางเดียวที่รักษา fallback คือ **ถอดความก่อน** (audio → text ด้วย Google) แล้วส่ง text เข้า router เดิม → นี่คือเหตุผลที่ 1.1.3 เปลี่ยน `supportsPdf` เป็น `capabilities: { pdf, audio }` ตั้งแต่ตอนนั้น

**quota:** คำสั่งเสียง 5 วิ ≈ 160 token vs พิมพ์ ≈ 20–30 token (5–8 เท่าใน TPM) แต่ที่ชนจริงบน free tier คือ **RPD นับครั้ง** — audio ในการเรียกเดียว = 1 request เท่าข้อความ · ถอดความก่อน = **2 request** → ต้องรอ 1.1 คุม provider/quota ได้ก่อน

## เบราว์เซอร์ — ความเสี่ยงจริงของงานนี้

| | Web Speech API | MediaRecorder + ส่งให้ AI |
|---|---|---|
| Safari iOS | "Partial" ตั้งแต่ 14.5 (caniuse) ไม่ระบุขาดอะไร | ✅ baseline ตั้งแต่ 14.1 |
| Chrome Android | Partial · **ส่งเสียงไป server ของ Google** ไม่ offline | ✅ |
| **LINE in-app (WKWebView บน iOS)** | ⚠️ **ขึ้นกับ LINE** — WebKit bug 239816 (RESOLVED WORKSFORME): `webkitSpeechRecognition` **มีบน `window` แต่โยน `service-not-allowed`** เว้นแต่**แอปเจ้าของ WebView** ประกาศ `NSSpeechRecognitionUsageDescription` — เราคุมไม่ได้ และ **feature detection หลอก** | ⚠️ `getUserMedia` ใน WKWebView ได้ตั้งแต่ iOS 14.3 ถ้าแอปมี `NSMicrophoneUsageDescription` — LINE มีแน่ (โทร/ส่งเสียง) จึงโอกาสสูงกว่ามาก แต่ Apple บังคับถาม permission ทุกครั้ง |
| ไทย | engine ของเบราว์เซอร์ ควบคุม/วัดไม่ได้ | Gemini รองรับทางการ ปรับ prompt ได้ |
| format | — | Safari อัด `audio/mp4` Chrome อัด `audio/webm` → ต้องตรวจ `isTypeSupported()` แล้วส่ง mediaType ให้ถูก (Gemini รับทั้งคู่) |
| quota | 0 | ตามบน |

**คำแนะนำ: MediaRecorder → `gemini-3.5-transcribe` → text เข้า router เดิม** — ไม่พึ่ง LINE ว่าจะเปิด Speech permission ให้ไหม · fallback provider ยังทำงาน · คุณภาพไทยมาจาก Gemini ที่ตรวจสอบได้

## ด่านแรกก่อนเขียนโค้ดสักบรรทัด

- [x] หน้า `/mic-test` (`c7db500`) — public, ไม่แตะระบบอื่น, มีคอมเมนต์ให้ลบเมื่อจบ — **deploy แล้วที่ `https://lavieos.netlify.app/mic-test`**
- [ ] **เปิดใน LINE บน iPhone จริง** กดปุ่ม แล้วบันทึกผลตรงนี้: getUserMedia ผ่าน/ไม่ผ่าน (`error.name`), MediaRecorder มีไหม, mimeType ที่ได้, ขนาดไฟล์ 3 วิ, UA
      → ผล: _______________
- [ ] ถ้าผ่าน: ทำตามคำแนะนำข้างบน · ถ้าไม่ผ่าน: งานนี้ทำไม่ได้บนช่องทางหลัก ยกไปคิดใหม่ (LIFF SDK? เปิดใน Safari แทน?)
- [ ] ใช้ `capabilities.audio` ที่มีแล้วกรอง provider ในหน้า Admin (1.1.6)
- [ ] **ลบ `src/routes/mic-test.tsx` เมื่อจบงานนี้**

---

# SSO — Aivora Hub (มีอยู่บน production แล้ว ตั้งแต่ 2026-09-13)

ไม่ใช่งานในแผน แต่เป็นระบบที่**อยู่บน production และมีผู้ใช้จริงผ่านมาแล้ว** บันทึกไว้เพื่อให้ทุกขั้นถัดไป (โดยเฉพาะ 1.2) รู้ว่ามันอยู่ตรงไหนและผูกกับอะไร

commit: `799a8f4` (ตาราง) · `eb75243` (โค้ด) · สเปกเต็มอยู่ในประวัติการคุยวันที่ 2026-09-13

## flow

```
ปุ่ม "เข้าสู่ระบบด้วย LINE (Aivora)" ที่ /auth
  → https://aivora-lc.netlify.app/sso/authorize?app=lifeos&return=<callback>
  → hub redirect กลับ /sso/callback?sso_ticket=…   (ตั๋วใช้ครั้งเดียว อายุ 60 วิ)
  → หน้า callback ลบ ticket ออกจาก URL ก่อน await แรก
  → server function exchangeSsoTicket → sso.server.ts:
       POST ticket ไป hub /api/public/sso/exchange
       ตรวจ app_slug = lifeos
       หา/สร้าง auth.users ด้วย hub user.id เท่านั้น
       ออก session: admin.generateLink(magiclink) → fetch /auth/v1/verify ด้วย publishable key
  → client setSession (retry เฉพาะขั้นนี้ ไม่แลกตั๋วซ้ำ) → อ่าน profile ตัวเอง → /today
```

## ตารางที่เกี่ยวข้อง

| ตาราง | บทบาท | FK / CASCADE |
|---|---|---|
| `auth.users` | ผู้ใช้ SSO เป็น user ปกติทุกอย่าง · `app_metadata.aivora_user_id` = id จาก hub · `app_metadata.provider = 'aivora'` (GoTrue เขียนทับเป็น `email` ใน JWT — ไม่กระทบ เราไม่อิง field นี้) · อีเมล = ของ hub ถ้ามี ไม่มี = `aivora+<hub id>@lavieos.netlify.app` | — |
| **`aivora_links`** | `aivora_user_id text PK` → `user_id uuid UNIQUE` · **ตัวเดียวที่ใช้หาผู้ใช้** ห้ามหาด้วยอีเมล | ✅ `user_id REFERENCES auth.users(id) ON DELETE CASCADE` — **ตารางเดียวใน schema ที่มี FK ไป auth.users** · RLS เปิด ไม่มี policy ไม่มี GRANT ให้ authenticated = service role เท่านั้น |
| `profiles` / `user_roles` | สร้างโดย trigger `on_auth_user_created` เหมือน signup ปกติ · role = `member` เสมอ **ไม่รับ roles จาก hub** · `display_name` จาก hub เติมเฉพาะตอนว่างหรือเป็น placeholder `aivora+…` ไม่ทับที่ผู้ใช้ตั้งเอง | ❌ ยังไม่มี FK (เหมือนตารางอื่น — งาน 1.2) |

## กฎความปลอดภัยที่ฝังอยู่ในโค้ด (อย่าแก้โดยไม่รู้ว่าทำไม)

- **หาด้วย `aivora_user_id` เท่านั้น** — ถ้าอีเมลจาก hub ตรงกับบัญชีที่มีอยู่แล้วในแอป **ปฏิเสธ** (`409 email_in_use`) ไม่ผูกให้ เพราะ hub ไม่ได้ยืนยันว่าอีเมลนั้นเป็นของคนนั้นจริง (ทดสอบแล้ว: victim ไม่ถูกแตะ)
- `user.id` จาก hub ต้องเป็น string ไม่ว่าง · ฟิลด์อื่นรับ `null` ได้ (ผู้ใช้ LINE มักไม่มีอีเมล)
- ออก session ด้วย `fetch` ตรงไป `/auth/v1/verify` **ไม่ใช่ `verifyOtp` บน admin client** — ไม่งั้น session ของผู้ใช้จะค้างใน service-role singleton
- service role ไม่หลุด client (`grep -ri service_role dist/client` = ว่าง)
- log ทุกกรณีรวมที่ตั้งใจปฏิเสธ (`[sso] <status> <code>: …`) ไม่ log token · 401 ตั๋วผิด / 403 slug ผิด / 409 อีเมลชน / 502 hub ล่ม

## ผู้ใช้จริงที่ผ่านมาแล้ว (ณ 2026-09-14)

2 คน — คนหนึ่งมีอีเมลจาก hub คนหนึ่งไม่มี (ได้อีเมลสังเคราะห์) ทั้งคู่ล็อกอินซ้ำสำเร็จ (path หาผู้ใช้เดิมทำงาน) ชื่อจาก hub ลง profile ครบ role = member — **ห้ามลบ** ดูรายชื่อได้จาก `select * from aivora_links`

## ที่ยังไม่ได้ทำ / ควรรู้

- ยังไม่มีฟีเจอร์ "เชื่อมบัญชี SSO กับบัญชีอีเมลเดิม" — สเปกให้ทำเป็นหน้าตั้งค่าแยก ต้องล็อกอินบัญชีเดิมก่อนถึงกด
- Netlify มี `SUPABASE_SERVICE_ROLE` (ชื่อตามสเปก SSO) ซ้ำกับ `SUPABASE_SERVICE_ROLE_KEY` ที่โค้ดใช้จริง — ตัวแรกไม่มีใครอ่าน ลบได้
