# Life OS — Feature Map & Backlog

อัปเดตล่าสุด: **2026-09-26 (รอบ Admin Premium/PAYG history + plan badge)**

อ้างอิงสเปก PDF:
- Functions&Features for 7 Systems & LIFE OS.pdf
- Functions&Features ของระบบ ช่วยฉันที ใน Life OS v2.pdf
- Life Legacy (ใน Life OS) Functions&Features v2.pdf

| สัญลักษณ์ | ความหมาย |
|-----------|----------|
| ✅ | ทำแล้ว |
| 🟡 | บางส่วน / MVP |
| ❌ | ยังไม่มี |

---

## เมนู / Route

| เมนู | Route | ระบบ |
|------|--------|------|
| วันนี้ | `/today` | AI Life Manager |
| คุยกับน้องภูมิ | `/chat` | AI |
| เอกสาร | `/docs` | Archive |
| เรื่องที่ต้องทำ | `/tasks` | Tasks |
| ปฏิทินรวม | `/agenda` | Unified Agenda |
| รายรับ-รายจ่าย | `/money` | Money |
| ครอบครัว | `/family` | Family Radar |
| ช่วยฉันที | `/helpme` | Marketplace |
| แดชบอร์ดผู้ช่วย | `/helper-dashboard` | Marketplace |
| สิทธิฉัน | `/benefits` | Benefits |
| ช่วยตัดสินใจ | `/decide` | Decision |
| ของดีใกล้บ้าน | `/local` | Local |
| แดชบอร์ดร้านค้า | `/local/merchant` | Local |
| ฝากไว้ / หลังเหตุการณ์ | `/legacy` `/legacy/after` | Life Legacy |
| Memorial | `/memorial/$token` | Legacy |
| สนับสนุน | `/support` | Billing + Donate |
| ตั้งค่า | `/settings` | Privacy |
| ผู้ดูแลระบบ | `/admin` (+ premium / payments / support / safety / marketplace) | Admin |
| ติดตั้งเป็นแอป | PWA (sidebar) | Platform |

---

## Feature map (ย่อ)

### AI / Docs / Tasks / Money / Agenda
| Feature | สถานะ |
|---------|--------|
| Document AI + import → Legacy | ✅ R3 |
| เรื่องที่ต้องทำ + recurring | 🟡 |
| สวิตช์สถานะงาน = done/open | ✅ |
| ปฏิทินรวม (รายการ/วัน/สัปดาห์/เดือน) | ✅ |
| จุดวันที่ local timezone | ✅ |
| Free / Premium / Family + PAYG | ✅ |
| แสดงแพ็กปัจจุบัน (sidebar + สนับสนุน) | ✅ |
| ปุ่มแพ็กปัจจุบัน disabled | ✅ |

### Marketplace (ช่วยฉันที)
| Feature | สถานะ |
|---------|--------|
| Escrow / PromptPay / Admin payout | ✅ |
| Chat + evidence + rating | ✅ |
| Safety report | ✅ |
| Match score เต็ม | 🟡 |

### Local
| Feature | สถานะ |
|---------|--------|
| Google Places API (เมื่อมี key) | 🟡 |
| maps_url บนการ์ดสถานที่ | ✅ |
| โปรโมชัน แก้ไข/ลบ | ✅ |

### Family / Agenda
| Feature | สถานะ |
|---------|--------|
| นัดหมาย / มอบหมายงาน | ✅ |
| ลบจากปฏิทินรวม | 🟡 |
| แสดงชื่อผู้รับมอบหมายทุกหน้า | 🟡 |
| จุดแดงเมนูปฏิทินรวม | 🟡 |

### Life Legacy
| Feature | สถานะ |
|---------|--------|
| Vault / wishes / contacts / invite | ✅ |
| Death case + post-life | ✅ |
| Memorial + digital wreath | ✅ R2 |

### Platform / Admin / Billing
| Feature | สถานะ |
|---------|--------|
| PWA ติดตั้งเป็นแอป (SW + prompt) | ✅ |
| Admin card ชื่อ **Premium / Family / PAYG** | ✅ |
| Admin ประวัติ: ชื่อ, วันเวลา, แพ็ก, อ้างอิง, ยอด, สถานะ (i18n) | ✅ |
| Premium insert ตอนแจ้งโอน (ไม่ draft) | ✅ |
| รายการชำระเงินของฉัน: ไม่โชว์ draft/QR | ✅ |

---

## Backlog ถัดไป

1. ชื่อผู้รับมอบหมายครบทุกหน้า + แก้ผู้รับในฟอร์ม
2. จุดแดง realtime ปฏิทินรวมเมื่อมีนัด/งานครอบครัวใหม่
3. Modal แก้ไขนัด/งานครอบครัวให้เดียวกับปฏิทินรวม
4. Google Places เต็มเมื่อ key + Places API (New) พร้อม
5. Cron ล้าง draft เก่า (ถ้ายังมีของ legacy)

---

## Changelog 2026-09-26

- Admin: หัวข้อ/การ์ด → 「ชำระเงิน Premium / Family / PAYG」
- Admin ประวัติ: แสดงชื่อ, วันที่-เวลา, แพ็ก, อ้างอิง, ยอด, สถานะตามภาษา
- Plan badge Free/Premium/Family ที่ sidebar + หน้าสนับสนุน
- ปุ่มอัปเกรดของแพ็กปัจจุบัน disabled
- PWA: service worker + early beforeinstallprompt
- Task switch = สถานะงาน
- Premium flow แบบบริจาค (ไม่ insert draft)
