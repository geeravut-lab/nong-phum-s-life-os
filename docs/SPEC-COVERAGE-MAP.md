# Spec Coverage Map — PDF สเปก ↔ เมนู/หน้าในระบบจริง

จัดทำ 2026-09-26 จากการอ่านสเปก 3 ไฟล์เทียบกับโค้ดใน repo (ไม่ใช่เทียบกับเอกสารสถานะเดิม)

สเปกต้นทาง:

1. `Functions&Features for 7 Systems & LIFE OS.pdf` (18 หน้า)
2. `Functions&Features ของระบบ ช่วยฉันที ใน Life OS v2.pdf` (2 หน้า)
3. `Life Legacy (ใน Life OS) Functions&Features v2.pdf` (5 หน้า)

## วิธีอ่านตาราง

| สัญลักษณ์ | ความหมาย                             |
| --------- | ------------------------------------ |
| ✅        | มีโค้ดครบและมีหน้าให้ใช้จริง         |
| 🟡        | มีบางส่วน / MVP / ยังไม่ครบตามสเปก   |
| ❌        | **ยังไม่มี** — ไม่พบร่องรอยในโค้ดเลย |

**ข้อควรระวัง:** ✅ ในเอกสารนี้หมายถึง "มีโค้ดและมีหน้า" เท่านั้น ไม่ได้แปลว่ามีคนทดสอบครบทุกเส้นทางแล้ว
สถานะการทดสอบดูที่ `FEATURE-MAP-AND-BACKLOG.md`

---

## 1. AI Life Manager → `/today` `/chat` `/docs` `/tasks` `/money`

| สเปก                               | หน้า/ที่อยู่                            | สถานะ |
| ---------------------------------- | --------------------------------------- | ----- |
| AI Inbox (ข้อความ/รูป/ไฟล์)        | `/chat` + `PhumQuickBar`                | ✅    |
| Document AI (OCR/สรุป/ดึงค่า)      | `/docs` · `doc-intake.ts`               | ✅    |
| Bill & Expense                     | `/money`                                | ✅    |
| Reminder & Calendar                | `/tasks` `/agenda`                      | ✅    |
| Personal Dashboard                 | `/today`                                | ✅    |
| AI Daily Brief                     | `/today`                                | ✅    |
| Recurring Tasks                    | `recurrence.ts` + `cron.server.ts` tick | ✅    |
| Privacy Center                     | `/settings` · `privacy.functions.ts`    | ✅    |
| Monetization (Free/Premium/Family) | `/support` · `billing.functions.ts`     | ✅    |
| **Search & Personal Memory**       | —                                       | ❌    |

**ช่องว่างสำคัญ:** สเปกเขียนถึง "ค้นข้อมูลของผู้ใช้ด้วยภาษาธรรมชาติ" และ LIFE OS Core ก็ระบุ
**Universal Search** ไว้ แต่ไม่พบฟังก์ชันค้นหาข้ามโมดูลในโค้ดเลย (`/docs` มีตัวกรองในหน้าเท่านั้น)
นี่เป็น 1 ใน 5 ฟังก์ชัน MVP ที่สเปกหน้า 17 ระบุไว้ ("Ask My Life → ถามข้อมูลของตัวเอง")

---

## 2. ช่วยฉันที (Task Marketplace) → `/helpme` `/helper-dashboard`

| สเปก                                       | หน้า/ที่อยู่                              | สถานะ |
| ------------------------------------------ | ----------------------------------------- | ----- |
| AI Task Parser                             | `marketplace.server.ts`                   | ✅    |
| Task Posting                               | `/helpme`                                 | ✅    |
| Provider Matching                          | `marketplace.functions.ts`                | 🟡    |
| Quote & Offer                              | `/helpme` (`job_offers`)                  | ✅    |
| Booking & Status                           | `/helpme`                                 | ✅    |
| Chat & Evidence                            | `marketplace-chat.ts`                     | ✅    |
| Payment & Escrow                           | `payment.functions.ts`                    | ✅    |
| Rating & Trust                             | `/helpme`                                 | ✅    |
| Safety (report/block)                      | `marketplace-safety.ts` · `/admin/safety` | ✅    |
| Provider Dashboard                         | `/helper-dashboard`                       | ✅    |
| AI Price Guidance                          | `/helpme` (i18n + หน้า)                   | 🟡    |
| **Match Score ตามน้ำหนักในสเปก**           | —                                         | 🟡    |
| **ถอนข้อเสนอ (withdraw offer)**            | —                                         | ❌    |
| **Admin ตั้งค่า Commission / Service Fee** | `commission` มีในโค้ด                     | 🟡    |

**ช่องว่างสำคัญ:** สเปก v2 หน้า 2 กำหนดน้ำหนัก Match Score ชัดเจน (ทักษะ 35% / ระยะทาง 20% /
เวลาว่าง 15% / ราคา 10% / Rating 10% / ประสบการณ์ 10%) — ต้องตรวจว่าที่ทำไว้ตรงน้ำหนักนี้หรือไม่
และสเปกสั่งว่า **Admin ต้องเลือกได้ว่าจะเก็บรายได้แบบ Commission หรือ Service Fee (อย่างใดอย่างหนึ่ง
default = Commission)** — ยังไม่เห็นสวิตช์เลือกโมเดลนี้ใน `/admin`

---

## 3. Family Radar / Family OS → `/family`

| สเปก                      | หน้า/ที่อยู่                        | สถานะ |
| ------------------------- | ----------------------------------- | ----- |
| Family Group              | `/family`                           | ✅    |
| Role & Permission         | `/family` (`listFamilyPermissions`) | ✅    |
| Shared Calendar           | `/family` `/agenda`                 | ✅    |
| Family Tasks              | `/family` `/tasks`                  | ✅    |
| Care Check-in             | `/family`                           | ✅    |
| Family Alerts             | `app_notifications`                 | ✅    |
| Document Vault (ครอบครัว) | `/docs` (is_shared)                 | ✅    |
| Privacy & Consent         | `/settings` `/family`               | ✅    |
| AI Family Assistant       | `/chat`                             | 🟡    |
| Emergency Info            | Legacy trusted contacts             | 🟡    |
| **Routine Tracking**      | —                                   | ❌    |
| **Change Detection**      | —                                   | ❌    |
| **Family Expense ร่วม**   | —                                   | ❌    |

**ช่องว่างสำคัญ:** 3 ข้อท้ายคือหัวใจของ "Family Radar" ตามสเปกหน้า 10–11 — ตัวอย่างในสเปกคือ
_"แม่ไม่ได้ทำกิจกรรมตามปกติในช่วง 3 วันที่ผ่านมา"_ ซึ่งต้องมี Routine Tracking + Change Detection
ปัจจุบันมีแต่ Care Check-in แบบให้สมาชิกกดเอง ยังไม่มีการติดตามกิจวัตรหรือตรวจจับความเปลี่ยนแปลง
ส่วน Family Expense ร่วม (`/money` เป็นของรายบุคคล) ยังไม่มีการรวมค่าใช้จ่ายระดับครอบครัว

---

## 4. สิทธิฉัน (Benefits) → `/benefits`

| สเปก                         | หน้า/ที่อยู่                  | สถานะ |
| ---------------------------- | ----------------------------- | ----- |
| Profile & Eligibility        | `/benefits`                   | ✅    |
| Government Benefits Database | `benefits` (seed 12 รายการ)   | ✅    |
| Eligibility Engine           | `benefits.ts`                 | ✅    |
| AI Interview                 | `benefits-ai.server.ts`       | ✅    |
| Benefit Result               | `/benefits`                   | ✅    |
| Application Guide            | `/benefits`                   | ✅    |
| Source & Freshness           | `benefits` (มี field อ้างอิง) | 🟡    |
| Deadline Reminder            | ผ่าน reminders                | 🟡    |
| Province/Local Benefits      | —                             | ❌    |
| Save & Compare               | —                             | ❌    |
| Share ผลลัพธ์ให้ครอบครัว     | —                             | ❌    |

**ช่องว่างสำคัญ:** "Share ผลลัพธ์" เป็นกลไก viral ที่สเปกเน้นมาก (หน้า 12: _"ลองเช็กดูว่าคุณมีสิทธิอะไรบ้าง"_
คนแชร์ให้พ่อแม่ทันที) และอยู่ในหัวข้อ Growth & Viral (หน้า 5) ด้วย — ยังไม่มี

---

## 5. ของดีใกล้บ้าน (Local) → `/local` `/local/merchant`

| สเปก                            | หน้า/ที่อยู่                | สถานะ |
| ------------------------------- | --------------------------- | ----- |
| Location-aware Home             | `/local`                    | ✅    |
| AI Natural Search               | `parseLocalQuery`           | ✅    |
| Personalized Recommendations    | `rankPlaces`                | ✅    |
| Open Now                        | `local-hours.ts`            | ✅    |
| Local Business Profiles         | `/local/merchant`           | ✅    |
| Community Content               | `/local/merchant`           | ✅    |
| Local Deals (คูปอง/โปรโมชัน)    | `local_deals`               | ✅    |
| Merchant Dashboard              | `/local/merchant`           | ✅    |
| Reviews & Trust                 | `local_review` (มีตาราง)    | 🟡    |
| Google Places                   | `local-places.functions.ts` | 🟡    |
| AI Local Guide (วางแผนสนทนา)    | `/chat`                     | 🟡    |
| **Event**                       | —                           | ❌    |
| **Route & Itinerary (หลายจุด)** | —                           | ❌    |

**ช่องว่างสำคัญ:** สเปกหน้า 13–14 บรรยายการใช้งานหลักว่า _"เย็นนี้มีอะไรน่าทำกับลูกบ้าง งบไม่เกิน 500?"_
แล้วระบบรวม **Event / Workshop / ตลาด / Community event** มาจัดเป็นแผน — ปัจจุบันมีแต่ "สถานที่"
และ "โปรโมชัน" ไม่มี Event และไม่มีการจัดเส้นทางหลายจุด (Route & Itinerary)

---

## 6. AI ช่วยตัดสินใจ (Decision) → `/decide`

| สเปก                              | หน้า/ที่อยู่         | สถานะ |
| --------------------------------- | -------------------- | ----- |
| Decision Wizard                   | `/decide`            | ✅    |
| Context Interview                 | `decision.server.ts` | ✅    |
| Option Builder                    | `decision.server.ts` | ✅    |
| Criteria & Weighting              | `/decide`            | ✅    |
| Comparison Matrix                 | `/decide`            | ✅    |
| Pros/Cons & Risk                  | `/decide`            | ✅    |
| Decision Templates                | `decision.shared.ts` | ✅    |
| Confidence & Uncertainty          | `/decide`            | 🟡    |
| **Scenario Analysis**             | —                    | ❌    |
| **Evidence Mode (อ้างอิงภายนอก)** | —                    | ❌    |
| **Decision Journal (ย้อนหลัง)**   | —                    | ❌    |

**ช่องว่างสำคัญ:** Decision Journal ("เก็บเหตุผลและผลลัพธ์ย้อนหลัง") เป็นตัวสร้างการใช้ซ้ำ
และ `DECISION-BOARD.md` ในโปรเจกต์ก็อ้างถึง — ยังไม่มีในโค้ด

---

## 7. Life Archive → `/docs`

| สเปก                 | หน้า/ที่อยู่              | สถานะ |
| -------------------- | ------------------------- | ----- |
| Secure Vault         | `/docs` (storage private) | ✅    |
| OCR & Classification | `doc-intake.ts`           | ✅    |
| Metadata Extraction  | `/docs`                   | ✅    |
| Expiration Tracker   | `/docs` + reminders       | ✅    |
| Warranty Tracker     | `warranty` (9 ไฟล์)       | ✅    |
| AI Summary           | `/docs`                   | ✅    |
| Sharing & Permission | `/docs` (is_shared)       | ✅    |
| Relationship Links   | `source_document_id`      | 🟡    |
| Asset Register       | Legacy assets (`/legacy`) | 🟡    |
| **Full-text Search** | —                         | ❌    |
| **Family Timeline**  | —                         | ❌    |
| **Export & Backup**  | —                         | ❌    |

**ช่องว่างสำคัญ:** Export & Backup ไม่ใช่แค่ฟีเจอร์ขาย — มันอยู่ในหัวข้อ Security & Trust (หน้า 5)
ว่า **"Data export and deletion"** และผูกกับ PDPA ปัจจุบันมีเส้นทางลบบัญชี (`account.server.ts`)
แต่ **ไม่มีการส่งออกข้อมูล**

---

## 8. LIFE OS Core (หน้า 4–5 ของสเปก)

| สเปก                 | หน้า/ที่อยู่                     | สถานะ |
| -------------------- | -------------------------------- | ----- |
| One-box AI Inbox     | `/chat` + QuickBar               | ✅    |
| AI Router (intent)   | `phum.server.ts`                 | ✅    |
| Today Dashboard      | `/today`                         | ✅    |
| Command Center       | `phum-actions.ts`                | ✅    |
| Mobile-first + PWA   | `manifest.webmanifest` + `sw.js` | ✅    |
| **Universal Search** | —                                | ❌    |

### Life Modules ตามสเปก

Money ✅ · Documents ✅ · Tasks ✅ · Calendar ✅ · Family ✅ · Benefits ✅ · Local ✅ ·
Decision ✅ · Services ✅ · **Home & Assets (บ้าน/รถ/maintenance) 🟡** (มี warranty แต่ไม่มี
asset register ของสิ่งที่ยังใช้งาน แยกจาก Legacy)

### AI Layer

Personal Memory 🟡 · Context Engine ✅ · Daily Brief ✅ · Document Understanding ✅ ·
Confidence & source display 🟡 · Human handoff ✅ (`/admin/support`) ·
AI guardrails + confirmation ✅ · **Proactive Suggestions ❌** ·
**Natural-language automation ("เตือนก่อนประกันหมด 30 วัน") 🟡** ·
**AI-generated forms/questionnaires ❌**

### Integrations

LINE ✅ (`line-*.ts` ครบชุด: link, push, flex, deliver) · Maps 🟡 (Google Places) ·
Payment gateway 🟡 (PromptPay QR + แจ้งโอน ยังไม่ใช่ gateway จริง) ·
SSO ✅ (`sso.*`) · **Email/calendar ❌** · **Cloud storage ❌** ·
**Government/open-data ❌** · **Webhook/API for third-party ❌**

---

## 9. Admin & Platform (หน้า 5)

| สเปก                                | หน้า/ที่อยู่                                    | สถานะ |
| ----------------------------------- | ----------------------------------------------- | ----- |
| Admin dashboard                     | `/admin`                                        | ✅    |
| AI prompt/model configuration       | `/admin` (`getAiConfig`)                        | ✅    |
| Moderation & report handling        | `/admin/safety`                                 | ✅    |
| Billing/subscription mgmt           | `/admin/premium` `/admin/payments`              | ✅    |
| Audit logs                          | `privacy.functions.ts` · `support.functions.ts` | 🟡    |
| User/member management              | `/admin`                                        | 🟡    |
| **Content / knowledge-base mgmt**   | —                                               | ❌    |
| **Rules engine**                    | —                                               | ❌    |
| **Notification templates**          | —                                               | ❌    |
| **Analytics (funnel, DAU/WAU/MAU)** | —                                               | ❌    |
| **Feature flags / A/B testing**     | —                                               | ❌    |

---

## 10. Security & Trust (หน้า 5)

Consent management ✅ · RBAC ✅ (`has_role`) · Encryption in transit ✅ ·
Human confirmation before irreversible actions ✅ · Audit log 🟡 ·
Data deletion ✅ (`account.server.ts`) · **Data export ❌** ·
**Device/session management ❌** · Sensitive-data minimization 🟡 ·
Privacy policy consent records 🟡

**หมายเหตุสำคัญ (ยังค้างจาก Phase 0):** ไม่มี FK ไป `auth.users` และไม่มี `ON DELETE CASCADE`
ในตารางที่มี `user_id` — ดู `PHASE-0-MIGRATION.md` หัวข้อ 6 นี่กระทบข้อ "Data deletion" ข้างบน

---

## 11. Life Legacy (สเปกไฟล์ที่ 3) → `/legacy` `/legacy/after` `/memorial/$token`

สเปกกำหนดว่าผู้ใช้ควรเห็น 12 หัวข้อ ตารางนี้เทียบทีละข้อ:

| #   | สเปก                                       | ที่อยู่                                | สถานะ |
| --- | ------------------------------------------ | -------------------------------------- | ----- |
| 1   | ความต้องการของฉัน (Final Wishes)           | `/legacy`                              | ✅    |
| 2   | คนที่ฉันไว้ใจ (Trusted People)             | `/legacy`                              | ✅    |
| 3   | เอกสารสำคัญ                                | `/legacy` · `docs-legacy.functions.ts` | ✅    |
| 4   | ทรัพย์สินและภาระ                           | `/legacy` (legacy assets)              | ✅    |
| 5   | ตู้เซฟของฉัน (Secure Vault)                | `/legacy`                              | ✅    |
| 6   | **พินัยกรรมและมรดก (Will & Estate)**       | —                                      | ❌    |
| 7   | งานที่ต้องจัดการ (After-Life Checklist)    | `/legacy/after`                        | ✅    |
| 8   | งานศพ (Funeral Planner)                    | `funeral.functions.ts`                 | ✅    |
| 9   | สิ่งที่ฉันอยากฝากไว้ (Legacy Messages)     | `/legacy`                              | ✅    |
| 10  | **เรื่องราวชีวิตของฉัน (Life Story)**      | `legacy.server.ts`                     | 🟡    |
| 11  | อาลัยบุ๊ค (Memorial)                       | `/memorial/$token`                     | ✅    |
| 12  | ความตั้งใจเพื่อสังคม (Organ/Body Donation) | `/legacy` (migration phase5)           | ✅    |

### รายละเอียดย่อยที่ยังขาด

| สเปก                                                    | สถานะ | หมายเหตุ                                               |
| ------------------------------------------------------- | ----- | ------------------------------------------------------ |
| Death Notification + Multi-confirmation                 | ✅    | `death.functions.ts` · `legacy-notify.functions.ts`    |
| Trusted Contact Verification                            | ✅    |                                                        |
| **ส่ง SMS**                                             | ❌    | สเปกระบุชัด ปัจจุบันส่งผ่าน LINE + in-app เท่านั้น     |
| **ส่ง VDO อำลา**                                        | ❌    | ไม่มีเส้นทางอัปโหลด/ส่งวิดีโอ                          |
| AI Funeral Planner (Package A/B/C)                      | ✅    | `funeral.functions.ts`                                 |
| ผ่อนจ่าย 12/24/36 เดือน                                 | ✅    | `installment` มีในโค้ด                                 |
| Digital Wreath (พวงหรีด/เงินช่วยงาน)                    | ✅    | `/memorial/$token`                                     |
| **Eco Memorial (ปลูกต้นไม้แทนพวงหรีด)**                 | ❌    | สเปกระบุเป็นตัวเลือกให้ผู้ร่วมงาน                      |
| Asset Inventory (เงินฝาก/หุ้น/ประกัน ฯลฯ)               | ✅    |                                                        |
| **หน่วยงานที่จ่ายผลประโยชน์เมื่อเสียชีวิต**             | 🟡    | สเปกทำ `****` กำกับว่า **สำคัญมาก** ต้องตรวจว่าครบ     |
| Digital Asset Legacy (domain/social/ฯลฯ)                | 🟡    |                                                        |
| AI Legacy Assistant (ภูมิถามทีละเรื่อง)                 | 🟡    | คุยผ่าน `/chat` ได้ แต่ไม่มี flow สร้าง My Legacy Plan |
| Important Documents Map                                 | 🟡    |                                                        |
| Insurance & Benefit Finder เชื่อม LIFE OS               | 🟡    |                                                        |
| **Context-aware "ภูมิพบข้อมูลที่นำมาใส่ได้ เพิ่มไหม?"** | ❌    | สเปกเน้นว่าเป็นคุณค่าหลักของการ integrate              |

---

## สรุปช่องว่างที่ผมคิดว่าควรพิจารณาก่อน

เรียงตามผลต่อผู้ใช้และความสอดคล้องกับสเปก:

1. **Universal Search / Ask My Life** — สเปกจัดเป็น 1 ใน 5 ฟังก์ชัน MVP (หน้า 17) แต่ยังไม่มีเลย
   เป็นช่องว่างใหญ่ที่สุดเทียบกับเจตนาเดิมของสเปก
2. **Data Export** — อยู่ใน Security & Trust และผูกกับ PDPA มีแต่การลบ ยังไม่มีการส่งออก
3. **Family Radar ตัวจริง** (Routine Tracking + Change Detection) — เป็นเหตุผลที่ระบบนี้ถูกจัดอันดับ 3
   ในสเปก ปัจจุบันมีแต่ Care Check-in แบบกดเอง
4. **Share ผลสิทธิฉัน** — กลไก viral ที่สเปกเน้นซ้ำ 2 ที่ ทำได้ไม่ยาก
5. **Admin เลือกโมเดลรายได้ Commission / Service Fee** — สเปก v2 สั่งไว้ตรง ๆ พร้อม default
6. **Local Event + Route/Itinerary** — เป็นแกนของ use case ตัวอย่างในสเปก ("เย็นนี้พาลูกไปไหน")
7. **พินัยกรรมและมรดก (Will & Estate)** — 1 ใน 12 หัวข้อที่สเปก Life Legacy บอกว่าผู้ใช้ต้องเห็น
   _(ทำโดยเก็บ "สำเนาและตำแหน่งของฉบับจริง" เท่านั้น ไม่ใช่ระบบทำพินัยกรรม — ดูหลักการใน
   `PHASE-0-MIGRATION.md`)_
8. **Decision Journal** — ตัวสร้างการใช้ซ้ำของโมดูล Decision
9. **SMS + VDO อำลา ใน Death Notification** — สเปกระบุชัด ปัจจุบันมีแต่ LINE/in-app
10. **Analytics + Feature flags** — ไม่กระทบผู้ใช้ แต่กระทบการตัดสินใจของเจ้าของระบบ

### สิ่งที่ครบเกินคาด

ระบบทำไปไกลกว่าที่เอกสารสถานะเดิมบอกในหลายจุด โดยเฉพาะ **LINE Messaging API ครบชุด**
(link / push / flex / deliver + quota guard), **Recurring reminder engine** ที่มี notified_at,
digest, idempotency และ rollover, **Escrow + PromptPay + Admin payout**, และ **Life Legacy**
ที่ทำไปถึง Death Verification, Post-Life Action Plan, Memorial และ Digital Wreath ครบ
