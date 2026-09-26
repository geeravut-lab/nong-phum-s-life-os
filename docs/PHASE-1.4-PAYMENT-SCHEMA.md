# 1.4 Payment rails — Schema & flow (Help Me Escrow)

อ้างอิง: `INVITED_ESCROW.md` + แบบ donation (1.11) ที่มีอยู่แล้ว

## หลักการ

- เงินลูกค้า**ไม่โอนตรงไป Helper** หลังจ่าย → ระบบ Hold (`payment_status = held`)
- ลูกค้า Verified หลังพบ/จบงาน → `released` → คิว Admin payout
- Admin โอนจริง + แนบสลิป → `payout_status = paid`
- ยกเลิก/ไม่ Verified ตามเวลา → `partial-refunded` + voucher (เฟสถัดไป) / Admin refund

## ตารางใหม่

### `job_payments` (ledger ต่อ job 1:1 ตอนนี้; ขยายหลายงวดได้ภายหลัง)

| คอลัมน์                 | ความหมาย                                                          |
| ----------------------- | ----------------------------------------------------------------- |
| `job_id` UNIQUE         | อ้างอิง jobs                                                      |
| `amount`                | ยอดที่ลูกค้าจ่าย (agreed_price + service_fee ถ้ามี)               |
| `platform_fee`          | ส่วนแพลตฟอร์ม                                                     |
| `provider_amount`       | ส่วน helper หลังหัก fee                                           |
| `payment_status`        | `pending` → `held` → `released` \| `partial-refunded` \| `failed` |
| `payout_status`         | `null` \| `pending` \| `paid` \| `refunded`                       |
| `service_ended`         | helper กดจบ                                                       |
| `verified_at`           | ลูกค้ากด Verified                                                 |
| `paid_at`               | ยืนยันรับเงินเข้า (PromptPay verify / gateway callback)           |
| `released_at`           | เวลา released                                                     |
| `payout_paid_at`        | Admin โอนแล้ว                                                     |
| `promptpay_id` snapshot | เลขพร้อมเพย์ตอนจ่าย                                               |
| `payer_ref`             | อ้างอิงที่ลูกค้ากรอก                                              |
| `cancel_fee_pct`        | % ค่าปรับ (default จาก platform_settings)                         |
| `payout_slip_path`      | path สลิปใน storage (optional)                                    |
| `notes`                 | หมายเหตุ admin                                                    |

### ขยาย `platform_settings`

- `promptpay_id` (ถ้ายังไม่มี — ใช้ร่วม donation settings ได้ แต่แยกชัดเจนกว่า)
- `cancel_fee_pct` default 20
- `escrow_enabled` boolean

> ตอนนี้ donation ใช้ `donation_settings` แยก — payment ของ Help Me ใช้ `platform_settings` + `job_payments` เพื่อไม่ปน ledger บริจาค

### ขยาย `jobs` (denormalize อ่านง่าย)

- `payment_status` text nullable (mirror จาก job_payments ล่าสุด)
- คง `agreed_price`, `platform_fee` ที่มีอยู่

## Flow กับ UI

1. **matched** → ลูกค้ากด "จ่ายเงิน" → สร้าง `job_payments` status `pending` + แสดง QR PromptPay (`promptpay.io/{id}/{amount}`)
2. ลูกค้าโอน + แจ้งอ้างอิง → `pending` ค้างให้ Admin ยืนยัน (แบบ donation) **หรือ** auto-held ถ้ามี gateway ภายหลัง
3. Admin ยืนยันรับเงิน → `held`, job ยังทำงานต่อได้
4. ถึงนัด / ระหว่างงาน: helper กด "จบบริการ" → `service_ended=true`
5. ลูกค้ากด "Verified / ยืนยันได้รับบริการ" → `released`, `payout_status=pending`
6. Admin โอน + แนบสลิป → `payout_status=paid`

### Auto-cancel

- เงื่อนไข: `scheduled_at + hours` ผ่านไปแล้วยังไม่ `verified_at` และยัง `held`
- รันใน cron tick (1.3 มีอยู่แล้ว) ด้วย transaction
- ผล: `partial-refunded`, ค่าปรับเข้า provider queue, ส่วนที่เหลือคิว refund

## RLS

- ลูกค้า (job owner): SELECT own payment, INSERT pending เท่านั้น
- Helper: SELECT payment ของ job ที่ assigned
- Admin: ALL
- UPDATE status สำคัญทำผ่าน server function + service role / requireAdmin

## ขอบเขต MVP 1.4 (รอบนี้)

- [x] migration schema + RLS
- [ ] UI จ่ายเงิน + QR บน job ที่ matched
- [ ] Admin หน้ารายการ held / payout queue
- [ ] ปุ่ม Verified + service_ended
- [ ] cron auto-cancel (ต่อจาก tick ที่มี)
- [ ] Voucher refund → เฟสถัดไป

PromptPay verify แบบ manual (Admin) ก่อน — เหมือน donation 1.11 — ไม่พึ่ง ChillPay ในรอบนี้
