# Phase 1 — Admin, Data Integrity, Notification & Payment

ต่อจาก `docs/PHASE-0-MIGRATION.md` ที่ปิดแล้ว

**หลักการที่ยังใช้ต่อ:** ทำทีละขั้น commit ทุกขั้น ตรวจแผนกับ repo จริงก่อนลงมือ และเมื่อแผนขัดกับสิ่งที่เห็นในโค้ด ให้เชื่อโค้ด

---

## ลำดับงาน

| ขั้น | งาน | เหตุผลที่อยู่ลำดับนี้ |
|---|---|---|
| **1.1** | Admin Console + AI provider/model switching | ติดปัญหา quota รายวันอยู่ตอนนี้ แก้แล้วได้ใช้ทันที และเป็นฐานของ Admin ที่ขั้นอื่นต้องใช้ |
| **1.2** | Data integrity & deletion path | เป็นงาน schema ยิ่งมีข้อมูลจริงมาก ยิ่งเติม FK ย้อนหลังยาก |
| **1.3** | Scheduler + LINE notification + Recurring reminder | ทั้งสามใช้ cron runner ตัวเดียวกัน ทำแยกจะได้ของซ้ำ |
| **1.4** | Payment rails | ใหญ่และเป็นอิสระ ทำหลังได้ |
| **1.5** | งานค้างเล็ก ๆ | Help Me rating UI, `.validator()` deprecation, bundle 600 kB |

---

# 1.1 Admin Console + AI Provider/Model Switching

## ปัญหาที่ต้องแก้

Gemini free plan มี quota รายวัน พอเต็มแล้วหน้า Chat กับ Docs พังทั้งคู่ ปัจจุบัน provider และ model ถูกกำหนดด้วย env ซึ่ง**ต้อง redeploy ถึงจะเปลี่ยนได้** ทำให้แก้ระหว่างวันไม่ทัน

## เป้าหมาย

Admin เปิดหน้าเว็บ เลือก provider และ model ได้เอง มีผลภายในไม่เกิน 1 นาที **โดยไม่ต้อง deploy ใหม่**

## 1.1.1 สิทธิ์ Admin

- [ ] ตรวจ enum ของ `user_roles.role` ในโค้ดจริงก่อน — schema เดิมมี `has_role()` และ role `member` อยู่แล้ว ดูว่ามี `admin` อยู่ในนั้นหรือยัง
- [ ] ถ้ายังไม่มี ให้เพิ่ม value `admin` เข้า enum ด้วย migration
- [ ] Bootstrap admin คนแรกด้วย SQL ตรง ๆ ใน Dashboard (ไม่ต้องทำ UI) — ให้บอกคำสั่งมา เจ้าของโปรเจกต์จะรันเอง
- [ ] Route `/admin` ต้องมี guard ทั้ง**ฝั่ง server** (server function เช็ค `has_role(auth.uid(), 'admin')`) และฝั่ง client (ซ่อนเมนู)

> **สำคัญ:** guard ฝั่ง client อย่างเดียวไม่พอ ใครก็พิมพ์ URL เข้าได้ การตรวจสิทธิ์จริงต้องอยู่ฝั่ง server ทุกครั้ง

## 1.1.2 ตารางเก็บค่า

- [ ] สร้างตาราง `ai_settings` แถวเดียว (pattern เดียวกับ `platform_settings` ที่มีอยู่แล้ว — `id boolean primary key default true`)

เก็บ:

| คอลัมน์ | ความหมาย |
|---|---|
| `default_provider` | `anthropic` / `openai` / `google` |
| `fallback_provider` | เจ้าสำรอง หรือ `null` = ปิด fallback |
| `model_overrides` | `jsonb` เก็บเป็น `{"google": {"chat": "...", "document": "...", "reasoning": "..."}, "anthropic": {...}}` — คีย์ไหนไม่มี = ใช้ค่า default ในโค้ด |
| `updated_at`, `updated_by` | ใครแก้ เมื่อไหร่ |

- [ ] **API key ยังอยู่ใน env เท่านั้น ห้ามเก็บลง DB เด็ดขาด** DB เก็บได้แค่ว่า "เลือกเจ้าไหน รุ่นไหน"
- [ ] RLS: ปฏิเสธทุกคน แล้วให้ฝั่ง server อ่าน/เขียนผ่าน service role หลังตรวจสิทธิ์ admin แล้ว

## 1.1.3 ลำดับความสำคัญของค่า

แก้ `resolveProvider()` และ `getModel()` ใน `ai-provider.server.ts` ให้อ่านตามลำดับ:

```
ai_settings (DB)  →  env (AI_PROVIDER)  →  ค่า default ในโค้ด
```

- [ ] ถ้า DB ชี้ไป provider ที่**ไม่มี API key ใน env** ต้องไม่ยอมให้บันทึกตั้งแต่ตอน admin กด save พร้อมบอกว่าขาด env ตัวไหน — อย่าปล่อยให้ไปพังตอนผู้ใช้เรียกใช้
- [ ] คง `assertAiProviderConfig()` ตอน boot ไว้เหมือนเดิม

## 1.1.4 Cache — จุดที่พังง่ายที่สุด

อ่าน DB ทุกครั้งที่เรียก AI จะช้าและเปลืองโดยไม่จำเป็น แต่ถ้า cache นานไป admin เปลี่ยนค่าแล้วไม่มีผล

- [ ] cache ค่าจาก `ai_settings` ไว้ระดับ module พร้อม **TTL 30 วินาที**
- [ ] เขียนให้ชัดใน UI ว่า "การเปลี่ยนแปลงมีผลภายใน 1 นาที"
- [ ] อย่าลืมว่าบน Netlify Functions แต่ละ instance มี cache ของตัวเอง — TTL คือสิ่งเดียวที่รับประกันความสอดคล้อง

## 1.1.5 ดึงรายชื่อ model ที่ใช้ได้จริง

Admin ต้องเห็นรายการ model ทั้งหมดของแต่ละเจ้า ไม่ใช่พิมพ์ชื่อเอง (พิมพ์ผิดแล้วพังตอน runtime)

- [ ] เขียน `listModels(provider)` เรียก API รายชื่อ model ของแต่ละเจ้า
- [ ] **ตรวจ endpoint จากเอกสารทางการของแต่ละเจ้าก่อน อย่าเดาจากความจำ** และใส่คอมเมนต์กำกับวันที่ตรวจสอบ
- [ ] cache ผลลัพธ์ 1 ชั่วโมง
- [ ] ถ้าเจ้าไหนไม่มี API รายชื่อ model ให้ fallback เป็นรายการที่ hardcode ไว้ในโค้ด พร้อมแสดงในหน้า Admin ว่ารายการนี้มาจากไหน (live หรือ hardcode)
- [ ] แสดงเฉพาะ provider ที่มี API key ใน env

> **ข้อควรระวัง:** ไม่ใช่ทุก model ที่อ่านรูปและ PDF ได้ ถ้า admin เลือก model ที่ไม่รองรับมาใช้กับงาน `document` หน้า Docs จะพัง — ถ้า API ของเจ้านั้นบอก capability มาด้วยให้ใช้กรอง ถ้าไม่บอก ให้มีปุ่ม "ทดสอบ" ในหน้า Admin ที่ยิงคำขอจริงหนึ่งครั้งก่อนบันทึก

## 1.1.6 หน้า Admin

- [ ] เลือก **default provider** และ **fallback provider** (fallback เลือก "ปิด" ได้)
- [ ] เลือก model แยกตามงาน — เป็นตาราง provider × task (`chat` / `document` / `reasoning`)
- [ ] ปุ่ม **ทดสอบ** ยิงคำขอจริงไปยัง provider+model ที่เลือก แสดงผลว่าสำเร็จหรือ error อะไร **ก่อน**บันทึก
- [ ] แสดงสถานะปัจจุบัน: ใช้เจ้าไหนอยู่, ใครแก้ล่าสุด, เมื่อไหร่
- [ ] ใช้ design system `luxury-clean-design-system` ให้เข้ากับส่วนอื่นของแอป

## 1.1.7 บันทึกเหตุการณ์ AI — ตัวช่วยที่จะได้ใช้ทุกวัน

ตอน quota เต็ม ต้องรู้ให้ได้ว่าเต็มตอนไหนและเจ้าไหน

- [ ] ตาราง `ai_events` เก็บ: `provider`, `task`, `status` (ok / fallback / error), `error_code`, `created_at`
- [ ] เขียน log ตอนเกิด fallback และตอน error เท่านั้น **ไม่ต้อง log ทุกคำขอที่สำเร็จ** (จะบวมเร็วมาก)
- [ ] หน้า Admin แสดง 50 รายการล่าสุด
- [ ] เพิ่มงานลบ event เก่ากว่า 30 วัน เข้าไปใน cron ของขั้น 1.3

## 1.1.8 ทดสอบ

- [ ] admin เปลี่ยน provider แล้วมีผลภายใน 1 นาที โดยไม่ deploy
- [ ] admin เปลี่ยน model ของงาน `document` แล้วอัปโหลดเอกสาร → ใช้ model ใหม่จริง
- [ ] ผู้ใช้ที่ไม่ใช่ admin เข้า `/admin` ไม่ได้ ทั้งผ่านเมนูและพิมพ์ URL ตรง
- [ ] เลือก provider ที่ไม่มี key → บันทึกไม่ได้ พร้อมข้อความบอกว่าขาด env ตัวไหน
- [ ] ทำให้ quota เต็มจริง (หรือใส่ key ผิด) → fallback ทำงาน และมีแถวใน `ai_events`

---

# 1.2 Data integrity & deletion path

ปัญหาที่ยืนยันแล้วตอน Phase 0: **ไม่มีคอลัมน์ไหนมี FK ไป `auth.users` เลย และไม่มี `ON DELETE CASCADE`**

หลักฐานที่เจอจริง: ลบ user ออกจาก `auth.users` แล้ว `profiles`, `user_roles`, `documents`, `reminders`, `expenses` ยังอยู่ครบ และเจอไฟล์ใน storage 3 ไฟล์ที่ไม่มีแถวใน `documents` คู่กัน (อัปโหลดสำเร็จแต่ AI ล้มเหลว ระบบไม่เขียน row และไม่มีอะไรลบไฟล์)

ขอบเขต:
- [ ] ล้าง orphan ที่มีอยู่ก่อน (ไม่งั้นสร้าง constraint ไม่ผ่าน)
- [ ] เติม FK + `ON DELETE CASCADE` ทุกตารางที่อ้าง user
- [ ] ลบไฟล์ใน storage เมื่อลบ document / ลบบัญชี
- [ ] จัดการกรณีอัปโหลดสำเร็จแต่ประมวลผลล้มเหลว — ต้องไม่ทิ้งไฟล์ค้าง
- [ ] flow ลบบัญชีของผู้ใช้เอง + audit log (ฐานของ PDPA)

---

# 1.3 Scheduler + LINE notification + Recurring reminder

สามงานนี้ใช้ cron runner ตัวเดียวกัน

- [ ] เลือกวิธีตั้งเวลา: Netlify Scheduled Functions หรือ `pg_cron` + `pg_net` ฝั่ง Supabase — **ต้องเทียบข้อดีข้อเสียก่อนเลือก อย่าเดา**
- [ ] LINE Messaging API (ไม่ใช่ LINE Notify ซึ่งปิดบริการแล้ว)
- [ ] `reminders` ยังไม่มีคอลัมน์ `notified` / `sent_at` ต้องเพิ่ม
- [ ] Recurring engine — `recurrence` (none/monthly/yearly) มี UI และเก็บลง DB แล้ว แต่ไม่มีโค้ดอ่านไปประมวลผลเลย reminder ที่ตั้งเป็น monthly จะไม่ถูกเลื่อนไปงวดถัดไป
- [ ] งานล้าง `ai_events` เก่ากว่า 30 วัน

> **หมายเหตุเรื่องการเชื่อมกับ Aivora Hub:** Life OS เป็นหนึ่งในแอปที่เปิดจาก LINE Launcher ซึ่งใช้ Firebase Auth ส่วน Life OS ใช้ Supabase Auth — ต้องตัดสินใจว่า Life OS อยู่ในชุด "business apps" ที่ผู้ใช้ล็อกอินเองที่แต่ละแอป หรือจะทำสะพานเชื่อม SSO ซึ่งเป็นงานใหญ่กว่ามาก **อย่าเพิ่งตัดสินใจตอนนี้ ยกไปคุยตอนเริ่ม 1.3**

---

# 1.4 Payment rails

- [ ] เลือก payment gateway ที่มีใบอนุญาต (Omise / GB Prime Pay / 2C2P / SCB)
- [ ] PromptPay QR + ผ่อนชำระ
- [ ] Admin ตั้งค่า commission / service fee ได้ (`platform_settings` มีคอลัมน์อยู่แล้ว แต่ยังไม่มี UI)
- [ ] Escrow-ready สำหรับ Task Marketplace

> **ต้องรู้ก่อนเริ่ม:** การเก็บเงินแล้วโอนต่อให้ผู้ให้บริการ เข้าข่ายธุรกิจบริการการชำระเงินภายใต้การกำกับของ ธปท. ควรปรึกษาที่ปรึกษากฎหมายก่อนเปิดใช้จริง

---

# 1.5 งานค้างจาก Phase 0

- [ ] Help Me — ฟีเจอร์ให้คะแนน (ตาราง `job_reviews` มีอยู่แล้ว ขาดแค่ UI)
- [ ] `createServerFn().inputValidator()` deprecated 7 จุด ใน `lifeos.functions.ts` และ `marketplace.functions.ts` → เปลี่ยนเป็น `.validator()`
- [ ] bundle หลัก 600 kB เกินเกณฑ์เตือน — พิจารณา code splitting
