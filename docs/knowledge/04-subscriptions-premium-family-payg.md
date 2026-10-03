# 04 · Premium / Family / PAYG และ loop ตรวจสลิป

## ปัญหาที่แก้

ขายแพ็กรายเดือน/รายปี + แพ็กครอบครัว + จ่ายตามใช้ โดยไม่มี payment gateway
และต้องตอบได้ว่า "ตอนนี้ใครใช้แพ็กอะไรอยู่ ถึงเมื่อไหร่ และสิทธิ์ตกถึงใครบ้าง"

## โครงที่ใช้

### สามแพ็ก สามความหมาย

| แพ็ก        | เก็บเงิน            | ให้สิทธิ์แก่                                      |
| ----------- | ------------------- | ------------------------------------------------- |
| **Premium** | รายเดือน / รายปี    | ผู้ซื้อคนเดียว                                    |
| **Family**  | รายเดือน / รายปี    | ผู้ซื้อ + สมาชิกครอบครัว ตามจำนวน seat ที่ตั้งไว้ |
| **PAYG**    | ยอดส่วนเกินรายเดือน | ไม่ให้สิทธิ์ — เป็นการชำระหนี้การใช้ที่เกินโควตา  |

### ตารางที่เกี่ยวข้อง

```
profiles.plan_tier, profiles.plan_expires_at   ← สถานะสิทธิ์ "ตอนนี้" (อ่านเร็ว)
premium_payments                               ← บัญชีรายรับทุกใบ (draft → pending → paid/rejected)
user_subscriptions                             ← ประวัติรอบการใช้สิทธิ์ (ledger)
ai_usage_monthly                               ← ตัวนับการใช้ต่อเดือนต่อผู้ใช้
platform_settings                              ← ราคา โควตาฟรี seat เพดาน fair-use
```

**ทำไมต้องมีทั้ง `profiles.plan_tier` และ `user_subscriptions`:** หน้าแรก ๆ ต้องรู้
สิทธิ์ของผู้ใช้ทุกครั้งที่โหลด — อ่านคอลัมน์เดียวบนแถว profile เร็วและง่าย
ส่วน `user_subscriptions` คือประวัติที่ตอบได้ว่าเคยจ่ายอะไรมาบ้าง

### สิทธิ์ของ Family ตกถึงสมาชิก — จุดที่พลาดง่ายที่สุด

```ts
// src/lib/billing.functions.ts
async function isPremiumActive(userId: string): Promise<boolean> {
  // 1) จ่ายเองและยังไม่หมดอายุ
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("plan_tier, plan_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (planIsLive(profile)) return true;

  // 2) ไม่ได้จ่ายเอง — เป็น seat ในครอบครัวที่เจ้าของถือแพ็ก family อยู่หรือเปล่า
  const { data: membership } = await supabaseAdmin
    .from("family_members")
    .select("family_id, created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership?.family_id) return false;

  const { data: family } = await supabaseAdmin
    .from("families")
    .select("owner_id")
    .eq("id", membership.family_id)
    .maybeSingle();
  const { data: ownerProfile } = await supabaseAdmin
    .from("profiles")
    .select("plan_tier, plan_expires_at")
    .eq("id", family.owner_id)
    .maybeSingle();
  if (!planIsLive(ownerProfile) || ownerProfile?.plan_tier !== "family") return false;

  // 3) seat ให้ตามลำดับการเข้าร่วม (created_at) — ไม่ใช่ตามใครขอก่อนวันนี้
  //    ถ้าให้ตามอย่างอื่น สมาชิกคนเดิมจะอยู่ในสิทธิ์นาทีนี้และหลุดนาทีถัดไป
  //    โดยไม่มีใครอธิบายได้ว่าทำไม AI หยุดทำงาน
  const settings = await loadBillingSettings();
  const { data: seats } = await supabaseAdmin
    .from("family_members")
    .select("user_id")
    .eq("family_id", membership.family_id)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, settings.familyMaxMembers));
  return (seats ?? []).some((m) => m.user_id === userId);
}
```

### วงจรการชำระ (เหมือนไฟล์ 03 แต่ของแพ็ก)

```ts
createPremiumOrder({ planTier, period })
  → อ่านราคาจาก settings (ไม่ hard-code) → insert premium_payments สถานะ draft
  → คืน { paymentId, amount, promptpayId, qrUrl }

confirmPremiumPaid({ paymentId, payerRef })      // ผู้ใช้กด "โอนแล้ว"
  → draft → pending + payer_ref
  → notifyAdmins(kind "billing_review", href "/admin/premium")

adminConfirmPremiumPayment({ paymentId })        // admin เห็นเงินเข้า
  → payment_status = paid, period_start/period_end
  → profiles.plan_tier + plan_expires_at         // ← สิทธิ์เริ่มที่นี่
  → insert user_subscriptions                    // ← ลง ledger
  → notifyUsers(kind "billing_result", href "/support")

adminRejectPremiumPayment({ paymentId })
  → rejected (+ แจ้งผู้ใช้) ; แถวที่ไม่ pending อยู่แล้วจะไม่ถูกแจ้งซ้ำ
```

จุดที่ต้องระวังในการคำนวณวันหมดอายุ:

```ts
const start = new Date();
const end = new Date(start);
if (pay.period === "yearly") end.setFullYear(end.getFullYear() + 1);
else end.setMonth(end.getMonth() + 1);
```

### PAYG: ชำระ "ส่วนเกิน" ของเดือน ไม่ใช่ซื้อสิทธิ์

```ts
const over = Math.max(0, total - settings.freeTotal); // จำนวนครั้งที่เกินโควตาฟรี
const amountBaht = (over * settings.paygUnitSatang) / 100; // × ราคาต่อครั้ง (สตางค์)
if (amountBaht <= 0) return { amount: 0, message: "no_overage" };
```

- ถ้าผู้ใช้เป็น premium อยู่แล้ว → `premium_skip` (ไม่ต้องเก็บ)
- แถว PAYG ลง `premium_payments` ด้วย `plan_tier: "payg"` → admin ตรวจด้วย flow เดียวกัน
- **`plan_tier: "payg"` ต้องไม่ไปตั้ง `profiles.plan_tier`** (ดูเงื่อนไข
  `if (pay.plan_tier !== "payg" && pay.user_id)` ในขั้นยืนยัน)
- ค้างจ่ายเกิน `payg_grace_days` → กฎอัตโนมัติตั้ง `profiles.ai_suspended`
  แล้วด่านโควตาปฏิเสธการเรียก AI ทั้งหมด **รวมผู้ใช้ที่มีแพ็ก** เพราะเป็นหนี้ของการใช้ที่เกิดแล้ว

### การจ่ายเงินอยู่ได้นานกว่าบัญชี

```ts
// แถวการจ่ายเงินถูกเก็บเป็น ledger โดย user_id ถูก null เมื่อผู้ใช้ลบบัญชี
// จึงไม่มีใครให้มอบสิทธิ์ และแถวนั้นก็ถูกทำเครื่องหมายว่า paid ไปแล้วข้างบน
if (pay.plan_tier !== "payg" && pay.user_id) {
  /* grant */
}
```

## กฎที่ห้ามละเมิด

1. **ราคาต้องมาจาก settings ทุกจุดที่แสดงและทุกจุดที่เก็บเงิน** รวมหน้า landing
   ก่อน login (ดูไฟล์ 10 เรื่อง `getPublicPricing`)
2. **Family ต้องให้สิทธิ์สมาชิกจริง** ไม่งั้น ฿149 ได้เท่ากับ ฿89 — ของจริงเคยเป็นแบบนั้น
3. **seat เรียงด้วยเกณฑ์ที่คงที่** (`created_at`) ไม่ใช่เกณฑ์ที่เปลี่ยนรายวัน
4. **PAYG ไม่ใช่แพ็ก** ห้ามตั้ง `plan_tier` จากการจ่าย PAYG
5. **ตรวจวันหมดอายุทุกครั้งที่ถามสิทธิ์** ไม่ใช่เชื่อ `plan_tier` เพียว ๆ (`planIsLive`)
6. **การยืนยันของ admin ต้องทำสามอย่างให้ครบ**: ตั้งสถานะจ่าย, มอบสิทธิ์, ลง ledger
   ขาดข้อใดข้อหนึ่งคือรายได้ที่ไม่มีสิทธิ์ตามมา หรือสิทธิ์ที่ไม่มีรายรับอธิบาย

## บทเรียนจากของจริง

- **แพ็ก Family ไม่ให้อะไรกับครอบครัวเลย** `isPremiumActive` อ่าน profile แถวเดียว
  และการยืนยันการจ่ายตั้ง `plan_tier` ให้ผู้ซื้อคนเดียว — ฿149 ได้เท่า ฿89 เป๊ะ ๆ
- **แถวการจ่ายเงินหายไปพร้อมบัญชี** ทำให้บัญชีรายรับไม่ตรง แก้ด้วยการเก็บแถวไว้
  แล้ว null `user_id` (ดูไฟล์ 13)
- **ผู้ใช้ไม่รู้ว่าแพ็กหมดอายุ** จนกว่า AI จะหยุดทำงาน → กฎ `premium_expiring`
  แจ้งล่วงหน้า 7 วัน (ดูไฟล์ 06)

## ลอกไปใช้อย่างไร

1. ตาราง `payments` (draft → pending → paid/rejected) + `subscriptions` (ledger)
   - คอลัมน์สิทธิ์ปัจจุบันบน `profiles`
2. เขียน `isActive(userId)` **หนึ่งฟังก์ชัน** ที่ทุกจุดเรียก และให้มันรู้เรื่อง
   สิทธิ์ที่ตกทอด (ครอบครัว/ทีม/องค์กร) ตั้งแต่ต้น
3. ราคาและ seat อยู่ในตารางตั้งค่า พร้อม default ในโค้ด
4. flow ยืนยันของ admin = ทำสามอย่างในหนึ่ง transaction เชิงตรรกะ + แจ้งผู้ใช้
5. ถ้ามี PAYG: นับการใช้ต่อเดือน → คิดเฉพาะส่วนเกิน → ค้างจ่ายแล้วระงับ
   โดยทำด่านระงับไว้ที่ชั้นเดียวกับด่านโควตา (ดูไฟล์ 10)
