# 10 · "ตั้งค่าบิลลิ่ง / โควต้า"

## ปัญหาที่แก้

ระบบที่เรียก AI มีต้นทุนจริงต่อการเรียก ต้องตอบให้ได้ว่า:

- ผู้ใช้ฟรีใช้ได้เท่าไหร่ ต่องานแต่ละชนิด และรวมทั้งหมด
- คนที่จ่ายเงินใช้ได้ "ไม่จำกัด" จริงหรือ (ถ้าไม่จำกัดจริง คนเดียวทำบิลพังได้)
- แพ็กที่ขายอยู่ขาดทุนหรือไม่
- ตัวเลขเหล่านี้ปรับได้โดยไม่ deploy

## โครงที่ใช้

### ตั้งค่าทั้งหมดอยู่แถวเดียว + default ในโค้ด

```ts
// src/lib/billing.functions.ts
export type BillingSettings = {
  marginPct: number; // บวกกำไรกี่ % จากต้นทุนประมาณการ
  costFactor: number; // ตัวคูณต้นทุน (ค่าเงิน/ค่าธรรมเนียม)
  freeChat: number; // โควตาฟรีต่อชนิดงาน
  freeDocument: number;
  freeDecision: number;
  freeTranscribe: number;
  freeTotal: number; // และเพดานรวม (เล็กกว่าผลบวกได้)
  premiumMonthly: number;
  premiumYearly: number;
  familyMonthly: number;
  familyYearly: number;
  paygEnabled: boolean;
  paygUnitSatang: number;
  paygGraceDays: number;
  familyMaxMembers: number;
  /** เพดาน fair-use ต่อเดือนของแพ็กที่จ่ายเงิน 0 = ไม่จำกัด */
  premiumMonthlyCap: number;
  promptpayId: string | null;
};

const DEFAULTS: BillingSettings = {
  marginPct: 20,
  costFactor: 1.18,
  freeChat: 40,
  freeDocument: 12,
  freeDecision: 8,
  freeTranscribe: 15,
  freeTotal: 60,
  premiumMonthly: 89,
  premiumYearly: 890,
  familyMonthly: 149,
  familyYearly: 1490,
  paygEnabled: false,
  paygUnitSatang: 50,
  paygGraceDays: 7,
  familyMaxMembers: 5,
  premiumMonthlyCap: 0,
  promptpayId: null,
};
```

อ่านด้วย `select("*")` + cast เป็น `Record<string, unknown>` โดยเจตนา:

```ts
// select * — คอลัมน์บิลลิ่งอาจยังไม่อยู่ใน generated types
const { data } = await supabaseAdmin.from("platform_settings").select("*").maybeSingle();
if (!data) return { ...DEFAULTS };
const d = data as unknown as Record<string, unknown>;
const n = (k: string, fb: number) => Number(d[k] ?? fb);
```

ทำให้เพิ่มคอลัมน์ตั้งค่าใหม่ได้โดยไม่ต้อง regenerate types ก่อน และไม่พังตอน
ที่ migration ยังไม่ push (ค่านั้นจะใช้ default)

### ด่านโควตา: ฟังก์ชันเดียวที่ทุกการเรียก AI ต้องผ่าน

```ts
export const checkAndConsumeAiQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ task: z.enum(["chat", "document", "decision", "transcribe"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const settings = await loadBillingSettings();

    // 1) ค้างจ่าย PAYG เกิน grace → ระงับ แม้เป็นผู้ใช้ที่มีแพ็ก
    //    เพราะเป็นหนี้ของการใช้ที่เกิดขึ้นแล้ว
    const { data: suspended } = await supabaseAdmin
      .from("profiles")
      .select("ai_suspended")
      .eq("id", context.userId)
      .maybeSingle();
    if (suspended?.ai_suspended)
      return { allowed: false, reason: "suspended", remaining: 0, message: "app:ai_suspended" };

    const premium = await isPremiumActive(context.userId); // รู้เรื่องสิทธิ์ครอบครัวด้วย
    const ym = yearMonthBangkok(); // เดือนตามเวลาไทย

    // 2) แถวตัวนับของเดือนนี้ (สร้างถ้ายังไม่มี)
    let { data: row } = await supabaseAdmin
      .from("ai_usage_monthly")
      .select("*")
      .eq("user_id", context.userId)
      .eq("year_month", ym)
      .maybeSingle();
    if (!row) {
      /* insert แล้วใช้แถวใหม่ */
    }

    // 3) แพ็กที่จ่ายเงิน: "นับ" แต่ไม่ "จำกัด" ด้วยโควตาฟรี
    //    โค้ดเดิม return ก่อนถึงตัวนับ → ไม่มีข้อมูลการใช้ของคนที่จ่ายเงินเลย
    //    ซึ่งคือกลุ่มเดียวที่ต้องใช้ตั้งราคา
    if (premium) {
      const cap = settings.premiumMonthlyCap;
      if (cap > 0 && usedTotal >= cap)
        return { allowed: false, reason: "fair_use", remaining: 0, message: "app:quota_fair_use" };
      await bump();
      return { allowed: true, reason: "premium", remaining: cap > 0 ? cap - usedTotal - 1 : null };
    }

    // 4) ผู้ใช้ฟรี: เกินโควตาต่อชนิด หรือเกินเพดานรวม
    if (usedTask >= limits[data.task] || usedTotal >= settings.freeTotal) {
      if (settings.paygEnabled)
        return {
          allowed: false,
          reason: "payg_required",
          remaining: 0,
          overageSatang: settings.paygUnitSatang,
          message: "app:quota_payg_required",
        };
      return { allowed: false, reason: "limit", remaining: 0, message: "app:quota_exhausted" };
    }

    await bump();
    return {
      allowed: true,
      reason: "free",
      remaining: Math.min(limits[data.task] - usedTask - 1, settings.freeTotal - usedTotal - 1),
    };
  });
```

### `message` เป็นรหัส ไม่ใช่ประโยค

```ts
// A code, not a sentence: the caller turns it into the user's language.
message: "app:quota_payg_required";
```

server ไม่รู้ภาษาของผู้ใช้ (ภาษาอยู่ใน localStorage ของ browser)
จึงส่งรหัสกลับไปให้ client แปลผ่าน dictionary (ดูไฟล์ 12)

### โควตาสองชั้นโดยเจตนา

ต่อชนิดงาน (`freeChat` 40, `freeDocument` 12, …) **และ** รวม (`freeTotal` 60)
โดยผลบวก (75) มากกว่าเพดานรวม (60) — ตั้งใจให้ผู้ใช้เลือกเองได้ว่าจะใช้โควตารวม
ไปกับงานชนิดไหน แต่ไม่สามารถใช้เต็มทุกชนิดพร้อมกัน

### เดือนคิดตามเวลาไทย

```ts
function yearMonthBangkok(d = new Date()): string {
  const t = new Date(d.getTime() + 7 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}
```

ไม่ทำข้อนี้ โควตาจะรีเซ็ตตอน 7 โมงเช้าของวันที่ 1 ไม่ใช่เที่ยงคืน

### ราคาบนหน้า landing (ก่อน login) ต้องมาจากที่เดียวกัน

```ts
// src/lib/pricing.functions.ts — ไม่มี auth middleware เพราะหน้านี้อยู่ก่อน login
export const getPublicPricing = createServerFn({ method: "GET" }).handler(async () => {
  // select("*") + Record<string, unknown> เพราะคอลัมน์บิลลิ่งยังไม่อยู่ใน types
});
```

ถ้า hard-code ราคาไว้ในหน้า landing วันหนึ่งหน้าแรกจะโฆษณาราคาที่ไม่มีใครตั้ง

## กฎที่ห้ามละเมิด

1. **"ไม่จำกัด" ไม่ได้แปลว่า "ไม่นับ"** นับทุกคน รวมคนที่จ่ายเงิน
2. **มีเพดาน fair-use ให้ตั้งได้** (0 = ปิด) ผู้ใช้คนเดียวต้องทำบิลพังไม่ได้
3. **ด่านโควตามีที่เดียว** ทุกการเรียก AI ผ่านมันหมด
4. **การระงับเพราะค้างจ่าย อยู่เหนือสิทธิ์ของแพ็ก** เพราะเป็นหนี้ของการใช้ที่เกิดแล้ว
5. **เดือน/วัน คิดตามเวลาผู้ใช้** ไม่ใช่ UTC
6. **ส่งรหัสกลับ ไม่ส่งประโยค** ให้ client แปล
7. **ราคาและโควตามีแหล่งเดียว** ใช้ทั้งหน้า landing, หน้าแพ็ก, และตอนเก็บเงิน

## บทเรียนจากของจริง

- **ผู้ใช้ที่จ่ายเงินไม่ถูกนับเลย** เพราะโค้ด `return` ก่อนถึงตัวนับ — ไม่มีข้อมูล
  ตั้งราคาสำหรับกลุ่มเดียวที่จ่ายเงิน
- **หน้า landing โฆษณาราคา hard-code** ไม่ตรงกับที่ admin ตั้งไว้
- **PAYG สัญญาว่าจะระงับเมื่อค้างจ่าย แต่ไม่มีโค้ดบังคับ** → กฎอัตโนมัติตั้ง flag
  และด่านโควตาอ่าน flag นั้น (ดูไฟล์ 06)
- **default model ของงาน reasoning เคยเป็นรุ่นแพงสุด** การเรียกหนึ่งครั้ง
  ~4k in / 1.2k out = ฿1.32 บน Opus แต่ ฿0.53 บน Sonnet ขณะที่ PAYG เก็บ ฿0.50
  → ขายต่ำกว่าทุนทุกครั้ง **บทเรียน: ต้องมีหน้าต้นทุน และต้องดูมันจริง ๆ**

## ลอกไปใช้อย่างไร

1. ตาราง `platform_settings` แถวเดียว + `DEFAULTS` ในโค้ด + ฟังก์ชันโหลดที่ merge กัน
2. ตาราง `*_usage_monthly(user_id, year_month, <ตัวนับต่อชนิด>, total_count)`
3. `checkAndConsumeQuota({ task })` หนึ่งตัว คืน `{ allowed, reason, remaining, message }`
   และ **นับก่อน return** ทุกเส้นทางที่อนุญาต
4. เพดาน fair-use สำหรับแพ็กจ่ายเงิน (0 = ปิด)
5. flag ระงับบน profile สำหรับหนี้ค้าง + กฎอัตโนมัติที่ตั้ง flag
6. หน้า admin: ทุกตัวเลขในตารางตั้งค่า + หน้าต้นทุนต่อ task/provider
7. ทดสอบ: ใช้จนเกินโควตาฟรี → ต้องได้ `reason: "limit"` หรือ `"payg_required"`;
   ผู้ใช้แพ็ก → `reason: "premium"` และ **ตัวนับต้องเพิ่ม**
