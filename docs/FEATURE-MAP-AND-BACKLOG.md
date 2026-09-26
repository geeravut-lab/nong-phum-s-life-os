# Life OS — Feature Map & Backlog

อัปเดตล่าสุด: **2026-09-26**

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
| ผู้ดูแลระบบ | `/admin` (+ premium/payments/support/safety/marketplace) | Admin |
| ติดตั้งเป็นแอป | PWA (sidebar) | Platform |

---

## Feature map (ย่อ)

### AI / Docs / Tasks / Money
| Feature | สถานะ |
|---------|--------|
| Document AI + import → Legacy | ✅ R3 |
| เรื่องที่ต้องทำ + recurring | 🟡 |
| สวิตช์สถานะงาน sync ปุ่ม | ✅ 2026-09-26 |
| ปฏิทินรวม (รายการ/วัน/สัปดาห์/เดือน) | ✅ |
| จุดวันที่ตาม local timezone | ✅ |
| Free / Premium / Family + PAYG | ✅ |
| แสดงแพ็กปัจจุบัน (sidebar + สนับสนุน) | ✅ 2026-09-26 |

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
| สถานที่ผู้ใช้ + maps_url ปุ่มแผนที่ | ✅ |
| โปรโมชัน แก้ไข/ลบ | ✅ |

### Family / Agenda
| Feature | สถานะ |
|---------|--------|
| นัดหมาย / มอบหมายงาน | ✅ |
| ลบจากปฏิทินรวม / ครอบครัว | 🟡 |
| แสดงชื่อผู้รับมอบหมาย | 🟡→กำลังเติม |
| จุดแดงเมนูปฏิทินรวม | 🟡 |

### Life Legacy
| Feature | สถานะ |
|---------|--------|
| Vault / wishes / contacts / invite | ✅ |
| Death case + post-life actions | ✅ |
| Memorial + digital wreath | ✅ R2 |

### Platform
| Feature | สถานะ |
|---------|--------|
| PWA ติดตั้งเป็นแอป | ✅ (SW + beforeinstallprompt) |
| Admin ops cards บนสุด | ✅ |
| Premium insert ตอนแจ้งโอน (ไม่ draft) | ✅ |

---

## Backlog ถัดไป

1. ชื่อผู้รับมอบหมายครบทุกหน้า + แก้ไขผู้รับ
2. จุดแดง realtime ปฏิทินรวมเมื่อมีนัด/งานครอบครัวใหม่
3. แก้ไขนัด/งานครอบครัวในหน้าครอบครัวให้ modal เดียวกับปฏิทินรวม
4. Google Places เต็มเมื่อ key + Places API (New) พร้อม
5. Cron ลบ/expire รายการค้าง (ถ้ามี)

---

## Changelog ล่าสุด (2026-09-26)

- Premium/Family/PAYG: ไม่สร้าง draft — insert ตอนแจ้งโอน
- รายการชำระเงินของฉัน: ไม่โชว์ QR/draft
- แผนที่สถานที่: ใช้ maps_url
- โปรโมชันร้าน: แก้ไข/ลบ
- แนบเอกสาร (เดิมใบเสร็จ)
- PWA menu + service worker
- แสดงแพ็ก Free/Premium/Family
- สวิตช์งาน = สถานะ done/open
