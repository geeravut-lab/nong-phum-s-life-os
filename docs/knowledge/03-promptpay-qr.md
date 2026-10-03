# 03 · รับเงินด้วย QR PromptPay (ไม่มี payment gateway)

## ปัญหาที่แก้

โครงการเล็กในไทยส่วนมากยังไม่มี payment gateway (ค่าธรรมเนียม + ขั้นตอนสมัคร)
วิธีที่ใช้ได้จริงคือ **QR PromptPay + ผู้ใช้โอน + คนตรวจสลิป**
ซึ่งไม่ยากเลย ยกเว้นสองเรื่องที่พลาดกันเสมอ:

1. ระบบต้องไม่บันทึกว่า "จ่ายแล้ว" เพราะผู้ใช้กดบอกว่าจ่ายแล้ว
2. คนตรวจต้องมีข้อมูลพอที่จะหารายการนั้นในสเตทเมนต์ได้

## โครงที่ใช้

### สร้าง QR: ไม่ต้องมี library

```ts
// src/lib/funeral.functions.ts
/** promptpay.io วาด QR ให้; ฝังจำนวนเงินไว้ในลิงก์ ผู้จ่ายจึงกรอกยอดผิดไม่ได้ */
function promptpayQr(id: string | null, amount: number): string | null {
  return id ? `https://promptpay.io/${id}/${amount.toFixed(2)}` : null;
}
```

`https://promptpay.io/<พร้อมเพย์ไอดี>/<ยอด>` คืนรูป QR ตามมาตรฐาน EMVCo
ของไทย — `<img src={qrUrl}>` ได้เลย ไม่ต้องมี dependency

**ฝังยอดเงินใน QR เสมอ** QR ที่ไม่มียอดทำให้ผู้ใช้พิมพ์ยอดเอง ซึ่งพิมพ์ผิดได้
และคนตรวจจะเจอยอดที่ไม่ตรงกับที่ควรเป็น

### เลขพร้อมเพย์มาจากตั้งค่า ไม่ hard-code และมี fallback

```ts
async function funeralPromptpayId(): Promise<string | null> {
  const { data: settings } = await supabaseAdmin
    .from("platform_settings")
    .select("funeral_promptpay_id, helpme_promptpay_id")
    .maybeSingle();
  const s = settings as {
    funeral_promptpay_id?: string | null;
    helpme_promptpay_id?: string | null;
  } | null;
  // บัญชีเฉพาะทางก่อน ถ้าไม่ได้ตั้งใช้บัญชีกลางของระบบ:
  // หน้าที่ไม่มี QR ให้จ่าย = หน้าที่ไม่มีใครจ่ายได้
  return s?.funeral_promptpay_id ?? s?.helpme_promptpay_id ?? null;
}
```

โครงการนี้มีสามช่อง (`billing_`, `helpme_`, `funeral_`) เพราะเงินสามก้อนอาจเข้าบัญชีต่างกัน
และทุกจุดที่ใช้มี fallback ไล่ลงมาหาบัญชีกลาง

### วงจรบังคับ: draft → review → paid / rejected

```
ผู้ใช้กดจ่าย      →  สร้างแถวสถานะ draft/pending + เก็บ promptpay_id และยอดลงแถว
แสดง QR + ช่องอ้างอิง →  "เลขอ้างอิงบนสลิป หรือ 4 ตัวท้ายบัญชี" (บังคับกรอก)
ผู้ใช้กด "แจ้งโอนแล้ว" →  สถานะ review + payer_ref + reported_at
                      →  notifyAdmins (LINE + ในแอป + จุดแดงเมนู admin)
admin ตรวจสเตทเมนต์   →  "ยืนยันว่าได้รับเงิน"  → paid  + แจ้งผู้จ่าย
                      →  "ตรวจไม่พบการโอน"    → กลับเป็น due/rejected + เหตุผล + แจ้งผู้จ่าย
ปฏิเสธแล้ววนซ้ำได้    →  ผู้จ่ายดูสลิปอีกครั้งแล้วแจ้งใหม่
```

จุดสำคัญคือ **สถานะ "รอตรวจ" ต้องมีอยู่จริงในฐานข้อมูล** ไม่ใช่เดาจากค่าว่าง:

```sql
-- supabase/migrations/20260928130000_funeral_installment_review.sql
ALTER TABLE public.funeral_installments
  DROP CONSTRAINT IF EXISTS funeral_installments_payment_status_check;
ALTER TABLE public.funeral_installments
  ADD CONSTRAINT funeral_installments_payment_status_check
  CHECK (payment_status IN ('due', 'review', 'paid', 'rejected', 'cancelled'));
ALTER TABLE public.funeral_installments ADD COLUMN IF NOT EXISTS reported_at timestamptz;
ALTER TABLE public.funeral_installments ADD COLUMN IF NOT EXISTS review_note text;
```

### ฝั่งผู้จ่าย: QR + ช่องอ้างอิง อยู่ในแถวเดียวกับยอดที่ต้องจ่าย

```tsx
// src/components/FuneralPlanStatus.tsx
{
  payingId === i.id && payQr ? (
    <div className="mt-2 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <p className="text-center text-sm font-medium">
        {t.p6PayAmount}: ฿{payQr.amount.toLocaleString()}
      </p>
      {payQr.qrUrl ? (
        <img
          src={payQr.qrUrl}
          alt="PromptPay"
          className="mx-auto size-48 rounded-lg bg-white p-2"
        />
      ) : (
        <p className="text-center text-xs text-destructive">{t.fnNoPromptpay}</p>
      )}
      <Label htmlFor={`ref-${i.id}`}>{t.fnPayerRefLabel}</Label>
      <Input
        id={`ref-${i.id}`}
        value={payerRef}
        maxLength={80}
        placeholder={t.fnPayerRefPlaceholder}
        onChange={(e) => setPayerRef(e.target.value)}
      />
      <Button disabled={busy || !payerRef.trim()} onClick={() => void reportInstallment()}>
        {t.fnReportSentBtn}
      </Button>
    </div>
  ) : null;
}
```

`bg-white p-2` รอบรูป QR จำเป็น — ใน dark mode QR บนพื้นเข้มสแกนไม่ติด

### ฝั่ง admin: แสดงเฉพาะที่รอตรวจ

```tsx
const awaitingCheck = (i: { payment_status: string; payer_ref: string | null }) =>
  i.payment_status === "review" || (i.payment_status === "due" && !!i.payer_ref);

{p.installments.filter(awaitingCheck).map((i) => (
  // ยอด · ครบกำหนด · เลขอ้างอิง · เวลาที่แจ้ง · ช่องหมายเหตุ
  // + ปุ่ม "ยืนยันว่าได้รับเงินแล้ว" / "ตรวจไม่พบการโอน"
))}
```

แผน 36 งวดที่แสดงทั้งหมดจะกลบงวดเดียวที่ต้องตอบวันนี้ — กรองก่อนแสดงเสมอ

### ทนช่วงที่ migration ยังไม่ push

deploy กับ `supabase db push` ไม่เกิดพร้อมกัน โค้ดจึงต้องเขียนได้ทั้งสองแบบ:

```ts
const reported = { payment_status: "review", payer_ref: data.payerRef, reported_at: ..., review_note: null };
let { error } = await supabaseAdmin.from("funeral_installments").update(reported as never).eq("id", id);
if (error) {
  // 23514 = CHECK ยังไม่รู้จัก 'review'; 42703/PGRST204 = ยังไม่มีคอลัมน์ใหม่
  if (error.code === "23514" || error.code === "42703" || error.code === "PGRST204") {
    ({ error } = await supabaseAdmin
      .from("funeral_installments")
      .update({ payer_ref: data.payerRef })   // ปล่อยสถานะเป็น due ที่มี payer_ref
      .eq("id", id));
  }
  if (error) throw new Error(error.message);
}
```

และ **ทั้งสองฝั่งอ่านสองรูปแบบนั้นว่า "รอตรวจ" เหมือนกัน** (`awaitingCheck` ข้างบน)
ฟีเจอร์จึงทำงานได้ทันทีที่ deploy ก่อน push

## กฎที่ห้ามละเมิด

1. **ห้ามตั้งสถานะ paid จากการกดของผู้จ่าย** การกดคือ "คำกล่าวอ้าง" ไม่ใช่ใบเสร็จ
2. **บังคับกรอกเลขอ้างอิง** ถ้าไม่บังคับ คนตรวจจะหารายการในสเตทเมนต์ไม่ได้เลย
3. **ฝังยอดใน QR** และเก็บยอด + เลขพร้อมเพย์ที่ใช้ "ลงแถวนั้น" (`promptpay_id`, `amount`)
   เพราะวันหลัง admin เปลี่ยนเลขบัญชี แถวเก่าต้องยังบอกได้ว่าโอนเข้าที่ไหน
4. **การปฏิเสธต้องกลับไปสถานะจ่ายได้ + มีเหตุผล** ไม่ใช่ค้างในสถานะกำกวม
5. **ทุกเส้นทางที่ออก QR ต้องมีที่ให้ "แจ้งโอนแล้ว"** QR ที่ไม่มีปลายทางคือทางตัน
6. **แจ้งทั้งสองทาง** admin รู้ว่ามีของรอตรวจ, ผู้จ่ายรู้ผลการตรวจ

## บทเรียนจากของจริง

- **"แจ้งชำระงวดนี้" เขียน `paid` ทันที** ไม่มี QR ไม่มีเลขอ้างอิง ไม่มีใครตรวจ
  ทั้งที่ค่าสมาชิกของระบบเดียวกันผ่าน admin มาตั้งแต่วันแรก — คนละ flow
  ในโครงการเดียวกันที่ทำเรื่องเดียวกัน คือสัญญาณว่าลืมทำครึ่งหนึ่ง
- **"จ่ายครั้งเดียว" ไม่สร้างแถวงวดเลย** (`if (schedule.length > 1)`)
  ผู้จ่ายจึงได้ QR มาแต่ไม่มีที่แจ้งว่าโอนแล้ว → แก้ให้สร้างแถวเสมอ (ตารางที่มีงวดเดียว)
  **บทเรียน: "กรณีเดียว" ต้องเดินทางเดียวกับ "หลายกรณี" ไม่ใช่ทางด่วนที่ข้ามขั้นตอน**
- **ผู้ช่วยไม่เคยรู้ว่าข้อเสนอถูกตอบรับ** เพราะโค้ดแจ้งเตือน _ก่อน_ เขียน
  `assigned_helper_id` ที่ฟังก์ชันแจ้งเตือนใช้ค้นหาผู้รับ → ค้นไม่เจอใคร
  **บทเรียน: ลำดับการเขียนกับการแจ้งเตือนสำคัญ หรือส่ง id ผู้รับไปตรง ๆ**

## ลอกไปใช้อย่างไร

1. ตารางการจ่ายเงินหนึ่งตาราง มี: `amount`, `payment_status` (CHECK ครบทุกสถานะ
   รวม `review`), `payer_ref`, `reported_at`, `paid_at`, `review_note`, `promptpay_id`
2. เลขพร้อมเพย์เก็บใน `platform_settings` + fallback ไล่ลงบัญชีกลาง
3. server fn สามตัว: `start…Payment` (คืน QR + ยอด), `report…Paid` (→ review + แจ้ง admin),
   `adminReview…` (→ paid / กลับ due + แจ้งผู้จ่าย)
4. UI: QR ใน `bg-white p-2`, ช่องอ้างอิงบังคับ, ปุ่มถัดไป disabled จนกรอก
5. ฝั่ง admin กรองเฉพาะที่รอตรวจ + ช่องหมายเหตุ + สองปุ่ม
6. ทดสอบ: จ่าย → ดูว่าแถวเป็น review ไม่ใช่ paid → ตรวจ → ดูว่า notification ถึงทั้งสองฝั่ง
