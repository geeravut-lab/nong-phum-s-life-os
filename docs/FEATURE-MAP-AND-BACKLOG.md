# Life OS — Feature Map & Implementation Backlog

เอกสารนี้ map **Functions & Features** จากสเปก 3 ไฟล์ กับเมนู/หน้าในระบบ  
และใช้ **track** งานที่ทำแล้ว / ค้าง / รอบถัดไป

**แหล่งสเปก**
- `Functions&Features for 7 Systems & LIFE OS.pdf`
- `Functions&Features ของระบบ ช่วยฉันที ใน Life OS v2.pdf`
- `Life Legacy (ใน Life OS) Functions&Features v2.pdf`

**สถานะ**
| สัญลักษณ์ | ความหมาย |
|-----------|----------|
| ✅ | ทำแล้ว ใช้ได้เป็นหลัก |
| 🟡 | ทำบางส่วน / MVP |
| ❌ | ยังไม่มี หรือโครงอย่างเดียว |
| 🔄 | กำลังทำในรอบปัจจุบัน |

อัปเดตล่าสุด: 2026-09-25

---

## 1. เมนู / หน้าในระบบ

| เมนู | Route | ระบบหลัก |
|------|--------|----------|
| วันนี้ | `/today` | AI Life Manager |
| แชท (น้องภูมิ) | `/chat` | AI Life Manager |
| เอกสาร | `/docs` | Life Archive |
| งาน | `/tasks` | AI Life Manager |
| เงิน | `/money` | AI Life Manager |
| ครอบครัว | `/family` | Family Radar |
| ช่วยฉันที | `/helpme` | Task Marketplace |
| แดชบอร์ดผู้รับงาน | `/helper-dashboard` | Task Marketplace |
| สิทธิฉัน | `/benefits` | Benefits |
| ช่วยตัดสินใจ | `/decide` | Decision Engine |
| ของดีใกล้บ้าน | `/local` | Local Intelligence |
| ร้านค้า | `/local/merchant` | Local Intelligence |
| ฝากไว้ | `/legacy` | Life Legacy (มีชีวิต) |
| หลังเหตุการณ์ | `/legacy/after` | Life Legacy (หลังเสียชีวิต) |
| รับคำเชิญผู้ยืนยัน | `/legacy/invite/$token` | Life Legacy |
| Memorial | `/memorial/$token` | Life Legacy |
| สนับสนุน | `/support` | Platform |
| ตั้งค่า | `/settings` | Platform |
| ผู้ดูแลระบบ | `/admin` (+ payments / marketplace / safety / support) | Admin |

---

## 2. Feature Map (สรุป)

### 2.1 AI Life Manager → `/chat` `/today` `/docs` `/tasks` `/money` `/settings`

| Feature | หน้า | สถานะ |
|---------|------|--------|
| AI Inbox | `/chat` | 🟡 |
| Document AI (OCR, metadata) | `/docs` `/chat` | 🟡 |
| Bill & Expense | `/money` | 🟡 |
| Reminder & Calendar | `/tasks` `/today` | 🟡 |
| Personal Dashboard | `/today` | 🟡 |
| AI Daily Brief | `/today` `/chat` | 🟡 |
| Search & Personal Memory | `/chat` | 🟡 |
| Recurring Tasks | `/tasks` | 🟡 |
| Privacy Center / audit | `/settings` | 🟡 |
| Monetization Free/Premium | — | ❌ |

### 2.2 ช่วยฉันที → `/helpme` `/helper-dashboard` `/admin/*`

| Feature | หน้า | สถานะ |
|---------|------|--------|
| AI Task Parser | `/helpme` | 🟡 |
| Task Posting | `/helpme` | ✅ |
| Provider Matching (35/20/15/10/10/10) | `/helpme` | 🟡 |
| Quote & Offer / Counter | `/helpme` | 🟡 |
| Booking & Status | `/helpme` | ✅ |
| Chat & Evidence | `/helpme` | ✅ |
| Payment & Escrow | `/helpme` `/admin/payments` | ✅ |
| Rating & Trust | `/helpme` | ✅ |
| Safety report/block | `/helpme` `/admin/safety` | ✅ |
| Provider Dashboard | `/helper-dashboard` | 🟡 |
| AI Price Guidance | `/helpme` | 🟡 |
| Admin Commission/Fee | `/admin` | ✅ |
| Location sharing | — | ❌ |
| Lead / promoted helper | — | ❌ |

### 2.3 Family Radar → `/family`

| Feature | หน้า | สถานะ |
|---------|------|--------|
| Family Group + members | `/family` | ✅ |
| Role & Permission ลึก | `/family` | 🟡 |
| Shared Calendar | `/family` | ❌ |
| Family Tasks มอบหมาย | `/family` `/tasks` | 🟡 |
| Care Check-in | — | ❌ |
| Routine Tracking | — | ❌ |

### 2.4 สิทธิฉัน → `/benefits`

| Feature | หน้า | สถานะ |
|---------|------|--------|
| Profile & Eligibility | `/benefits` | ✅ |
| Benefits DB + Engine | `/benefits` | 🟡 |
| AI Interview | `/benefits` | ✅ |
| Result + conditions | `/benefits` | ✅ |
| Application Guide | `/benefits` | 🟡 |
| Deadline Reminder | `/benefits` `/tasks` | 🟡 |
| Source & Freshness | `/benefits` | 🟡 |
| Province/Local | `/benefits` | 🟡 |
| Save & Compare | `/benefits` | 🟡 |
| Share to family | — | ❌ |

### 2.5 ของดีใกล้บ้าน → `/local` `/local/merchant`

| Feature | หน้า | สถานะ |
|---------|------|--------|
| Location-aware | `/local` | 🟡 |
| AI Natural Search | `/local` | ✅ |
| Personalized recs | `/local` | 🟡 |
| Open Now | `/local` | ✅ |
| Business profiles | `/local` | ✅ |
| Community / promoted | `/local` | 🟡 |
| Route & multi-stop | `/local` | 🟡 |
| Local Deals | `/local` | 🟡 |
| AI Local Guide | `/local` `/chat` | 🟡 |
| Reviews | `/local` | ✅ |
| Merchant Dashboard | `/local/merchant` | 🟡 |
| Merchant monetization | — | ❌ |

### 2.6 AI ช่วยตัดสินใจ → `/decide`

| Feature | หน้า | สถานะ |
|---------|------|--------|
| Wizard / Interview | `/decide` | ✅ |
| Options / Criteria / Matrix | `/decide` | ✅ |
| Scenario / Pros-Cons | `/decide` | 🟡 / ✅ |
| Evidence Mode (ภายนอก) | — | ❌ |
| Decision Journal | `/decide` | 🟡 |
| Templates | `/decide` | ✅ |

### 2.7 Life Archive → `/docs`

| Feature | หน้า | สถานะ |
|---------|------|--------|
| Secure store | `/docs` | ✅ |
| OCR / Classification | `/docs` | 🟡 |
| Metadata / expiry | `/docs` | 🟡 |
| NL Search | `/docs` `/chat` | 🟡 |
| Warranty tracker | — | ❌ |
| Family shared vault | — | ❌ |

### 2.8 Life Legacy

**ตอนมีชีวิต** `/legacy`

| Feature | สถานะ |
|---------|--------|
| Final Wishes / Trusted / Assets / Will ref / Checklist / Messages / Story / Donation | ✅ |
| Secure Vault (ข้อความ) | 🟡 |
| AI Legacy Assistant | ✅ |
| ดึงข้อมูลจาก Money/Family/Benefits อัตโนมัติ | 🟡 |
| เชิญผู้ยืนยัน + รหัสแผน | ✅ |

**หลังเสียชีวิต** `/legacy/after` `/memorial/$token`

| Feature | สถานะ |
|---------|--------|
| Multi-confirm death case | 🟡 |
| Verifier invite bind | ✅ |
| **Post-Life Action Plan (24h / 3d / later)** | ✅ R1 |
| AI Funeral Planner + PromptPay | ✅ |
| Memorial | ✅ |
| Digital Wreath | ✅ R2 |
| ข้อความรายบุคคล + Memorial/กำหนดการ + Wreath PromptPay + VDO ลิงก์ | ✅ R2 · SMS ❌ |
| LINE แจ้งเปิดเคส | 🟡 |

### 2.9 Platform

| Feature | สถานะ |
|---------|--------|
| LINE Login / OA | 🟡 |
| Realtime + จุดแดงเมนู | ✅ |
| Admin hub | ✅ |
| i18n TH/EN | ✅ |
| PDPA / audit เต็ม | 🟡 |

---

## 3. ช่องว่างสำคัญ (ยังขาดหรือบางมาก)

1. Post-Life Action Plan หลัง `confirmed` (24 ชม. / 3 วัน / ภายหลัง)
2. Death notification ครบ (SMS, VDO, ข้อความรายบุคคล, แนบกำหนดการ+QR)
3. Family ลึก: Shared Calendar, Care Check-in, มอบหมายงานในบ้าน
4. Document AI เต็ม (OCR, วันหมดอายุ, warranty)
5. Privacy Center / audit log ระดับผลิตภัณฑ์
6. Monetization (Premium, family plan, promoted listing)

---

## 4. Backlog แนะนำ — ทำเป็นรอบ

หลักการ: **ความเร่งด่วนสเปก Legacy + ผลกระทบผู้ใช้ + ต่อจากของที่มีอยู่แล้ว**

### Round 1 — Post-Life Action Plan (ฐาน)
**เป้าหมาย:** เมื่อเคสถูก `confirmed` ระบบสร้างรายการงานตามช่วงเวลา และให้ผู้เกี่ยวข้องติ๊กทำได้

| งาน | รายละเอียด | สถานะ |
|-----|------------|--------|
| R1.1 | Migration `post_life_actions` | ✅ |
| R1.2 | Seed อัตโนมัติเมื่อ `death_cases.status = confirmed` | ✅ |
| R1.3 | UI รายการงานบน `/legacy/after` (กลุ่ม 24h / 3d / later) | ✅ |
| R1.4 | Mark done / note โดย linked verifier หรือ admin | ✅ |
| R1.5 | อัปเดตเอกสารนี้ | ✅ |

### Round 2 — Death communication ขยาย
| งาน | รายละเอียด | สถานะ |
|-----|------------|--------|
| R2.1 | Template ข้อความแจ้งรายบุคคล (จาก contacts + plan) | ✅ |
| R2.2 | แนบลิงก์ Memorial + กำหนดการจาก funeral plan | ✅ |
| R2.3 | Digital Wreath ชำระเงินจริง (PromptPay) | ✅ |
| R2.4 | VDO อำลา (ลิงก์ YouTube/URL) บน Memorial | ✅ |
| R2.5 | SMS gateway (ถ้ามี provider) — optional | ❌ |

### Round 3 — Document AI + Legacy เชื่อมข้อมูล
| งาน | รายละเอียด | สถานะ |
|-----|------------|--------|
| R3.1 | OCR / จัดประเภทเอกสารใน `/docs` | ❌ |
| R3.2 | Expiration tracker → สร้างเตือนใน `/tasks` | ❌ |
| R3.3 | “พบข้อมูลใน LIFE OS ให้เพิ่มในแผนฝากไว้” (Money/Family/Benefits) | ❌ |
| R3.4 | Warranty tracker | ❌ |

### Round 4 — Family Radar ลึก
| งาน | รายละเอียด | สถานะ |
|-----|------------|--------|
| R4.1 | Shared Calendar | ❌ |
| R4.2 | Family task assign + notify | ❌ |
| R4.3 | Care Check-in | ❌ |
| R4.4 | Permission รายหมวดข้อมูล | ❌ |

### Round 5 — Trust, Privacy, Monetization
| งาน | รายละเอียด | สถานะ |
|-----|------------|--------|
| R5.1 | Privacy Center + audit log | ❌ |
| R5.2 | Location sharing (ช่วยฉันที) แบบ opt-in | ❌ |
| R5.3 | Premium / family plan skeleton | ❌ |
| R5.4 | Promoted listing (Local / Helper) | ❌ |

### Round 6 — เก็บกวาดคุณภาพ
| งาน | รายละเอียด | สถานะ |
|-----|------------|--------|
| R6.1 | Matching น้ำหนักครบ + counter-offer cron | ❌ |
| R6.2 | Provider/Merchant analytics | ❌ |
| R6.3 | Decision Evidence Mode | ❌ |
| R6.4 | Share benefits result to family | ❌ |

---

## 5. บันทึกการดำเนินการ (Changelog)

### 2026-09-25 — สร้างเอกสาร + เริ่ม Round 1
- สร้าง `docs/FEATURE-MAP-AND-BACKLOG.md`
- จัดลำดับ backlog R1–R6
- **Round 1 เสร็จ (โค้ด):**
  - Migration `post_life_actions` + trigger หลัง `confirmed`
  - `listPostLifeActions` / `updatePostLifeAction`
  - UI บน `/legacy/after` แยกเฟส 24h / 3d / later + ปุ่มทำแล้ว/ข้าม/เปิดใหม่
- **รอบถัดไปที่แนะนำ:** Round 2 (Death communication)


---

## 6. วิธีใช้เอกสารนี้

1. ก่อนเริ่มงาน: ดูตาราง Round ที่เปิดอยู่ เปลี่ยน ❌ → 🔄  
2. หลัง merge/deploy: เปลี่ยน 🔄 → ✅ และใส่หมายเหตุใน Changelog  
3. เมื่อเปลี่ยนลำดับความสำคัญ: แก้ข้อ 4 แล้วลงวันที่ใน Changelog  


### 2026-09-25 — Round 2
- ข้อความแจ้งรายบุคคล (`death_notify_messages` + generate/list)
- ลิงก์ Memorial + กำหนดการจาก funeral plan ในข้อความ
- Digital Wreath PromptPay QR + mark paid
- VDO อำลา (ลิงก์) + เปิดเผย memorial สาธารณะ
- SMS gateway ยังไม่ทำ (optional ภายหลัง)
