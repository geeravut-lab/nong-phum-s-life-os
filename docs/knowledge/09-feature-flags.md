# 09 · "สวิตช์ฟีเจอร์" ที่ปิดได้จริง

## ปัญหาที่แก้

ต้องปิดฟีเจอร์ได้ทันทีโดยไม่ deploy เพราะ:

- ฟีเจอร์ที่เรียก API ที่คิดเงิน (Google Places) ถ้าบิลพุ่งต้องปิดได้เดี๋ยวนั้น
- ฟีเจอร์ที่สัญญาว่าจะมีคนมาทำต่อ (AI Funeral Planner) ถ้าไม่มีคนรับ ต้องไม่โชว์ครึ่ง ๆ
- ฟีเจอร์ที่ยังไม่พร้อม (voice input) ต้องปล่อยโค้ดขึ้นได้โดยไม่ปล่อยฟีเจอร์

และ **ข้อผิดพลาดที่พบบ่อยที่สุดคือซ่อนปุ่มแล้วคิดว่าปิดแล้ว**

## โครงที่ใช้

### รายการ flag อยู่ในโค้ด ค่าอยู่ในฐานข้อมูล

```ts
// src/lib/flags.ts
/**
 * key ที่ไม่มีอยู่ = เปิด
 * การเพิ่ม flag ต้องไม่ทำให้ของที่ ship แล้วปิดลง และการที่ฟีเจอร์หายไป
 * ต้องเกิดจาก admin ปิดมันเท่านั้น
 */
export const FEATURE_FLAGS = ["google_places", "funeral_planner", "voice_input"] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FlagMap = Partial<Record<FeatureFlag, boolean>>;

export function isEnabled(flags: FlagMap | undefined, flag: FeatureFlag): boolean {
  return flags?.[flag] !== false; // undefined → เปิด
}
```

เก็บใน `platform_settings.feature_flags` (jsonb) และ **เก็บเฉพาะตัวที่ถูกปิด**:

```ts
// src/lib/admin.functions.ts — setFeatureFlag
const flags = { ...((row?.feature_flags ?? {}) as Record<string, boolean>) };
if (data.enabled)
  delete flags[data.flag]; // เปิด = ลบ key ออก
else flags[data.flag] = false; // ปิด = เขียน false
```

ทำแบบนี้ jsonb จะมีแต่สิ่งที่ผิดจากปกติ อ่านง่ายและไม่ต้อง migrate ตอนเพิ่ม flag

### สองชั้น: ชั้น UI (ความสุภาพ) + ชั้น server (ความจริง)

```ts
// src/lib/flags.server.ts
/**
 * ซ่อนปุ่มไม่ใช่การปิดฟีเจอร์: server function ที่อยู่ข้างหลังปุ่มนั้น
 * ยังถูกเรียกได้โดยใครก็ที่รู้ว่ามันมีอยู่ — และในกรณีของ Google Places
 * นั่นหมายถึงบิลที่ยังเดินต่อ ทุก flag จึงถูกเช็กที่นี่ ที่ server
 * และการเช็กใน UI มีไว้เพื่อไม่ให้ผู้ใช้เจอ error ของฟีเจอร์ที่ไม่เคยถูกเสนอให้
 */
const TTL_MS = 60_000;
let cache: { flags: FlagMap; at: number } | undefined;

export async function loadFlags(): Promise<FlagMap> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.flags;
  try {
    const { data } = await supabaseAdmin
      .from("platform_settings")
      .select("feature_flags")
      .maybeSingle();
    cache = { flags: (data?.feature_flags ?? {}) as FlagMap, at: now };
  } catch (err) {
    // อ่านตั้งค่าไม่ได้ ต้องไม่ลากฟีเจอร์ที่ใช้งานได้ลงไปด้วย:
    // เก็บค่าเดิมไว้ และถ้าไม่เคยมี ให้ถือว่าทุกอย่างเปิด
    console.warn("[flags] could not read:", err);
    cache = { flags: cache?.flags ?? {}, at: now };
  }
  return cache.flags;
}

/** ปฏิเสธการเรียกเมื่อ admin ปิดฟีเจอร์ไว้ */
export async function assertFeature(flag: FeatureFlag): Promise<void> {
  if (!(await featureEnabled(flag))) throw appError("feature_off");
}
```

ใช้ที่ต้นทางของทุก server function ที่เป็นของฟีเจอร์นั้น:

```ts
.handler(async ({ data, context }) => {
  await assertFeature("funeral_planner");   // ← บรรทัดแรก ก่อนทำอะไรทั้งนั้น
  // …
});
```

### เวลา cache ของสองฝั่งต้องใกล้กัน

| ฝั่ง   | TTL                                     | เหตุผล                                           |
| ------ | --------------------------------------- | ------------------------------------------------ |
| server | 60s (`flags.server.ts`)                 | อ่านหน้าทุก AI call — ใส่ DB read ทุกครั้งไม่ได้ |
| client | `staleTime 30s` + `refetchInterval 60s` | เปลี่ยนหน้าแล้วเห็นค่าใหม่เกือบทันที             |

> เดิม client cache 5 นาที ซึ่งทำให้ admin ปิดสวิตช์แล้วไม่ถึงใครเลยจนกว่าจะ
> reload แท็บ — การเปลี่ยนหน้าไม่ refetch query ที่ React Query ยังถือว่า fresh
> และสวิตช์ดูเหมือนพัง

ค่าสองฝั่งใกล้กัน → ปุ่มกับ call ที่อยู่ข้างหลังหยุดทำงานในจังหวะเดียวกัน
ไม่ใช่อันหนึ่งค้างอยู่หลังอีกอัน

### ล้าง cache ของ instance ที่รับการเขียน

```ts
// ท้าย setFeatureFlag
const { invalidateFlagsCache } = await import("@/lib/flags.server");
invalidateFlagsCache();
```

มันล้างแค่ instance ที่เสิร์ฟการเขียนนั้น (instance อื่นรอ TTL หมด)
แต่กำจัดกรณีที่แย่ที่สุด: admin ปิดสวิตช์ แล้วลองใช้ทันทีบน instance เดิม
และพบว่ามันยังทำงานอยู่

### ฝั่ง UI: กำลังโหลด = เปิด

```ts
/**
 * ระหว่าง query ยังวิ่ง ทุก flag อ่านว่าเปิด ซึ่งเป็นทิศที่ปลอดภัยกว่า:
 * ฟีเจอร์โผล่แวบหนึ่ง ดีกว่าหน้าเว็บกระพริบเอามันหายไป
 */
export function useFeatureFlags() {
  const q = usePlatformSettings();
  return { flags: q.data?.flags, enabled: (flag: FeatureFlag) => isEnabled(q.data?.flags, flag) };
}
```

```tsx
// ฟีเจอร์ที่ปิดต้องหายทั้งก้อน ไม่ใช่หายแค่ปุ่ม
{
  flags.enabled("funeral_planner") ? <section>{/* ทั้ง section */}</section> : null;
}
{
  flags.enabled("funeral_planner") ? <FuneralPlanStatus /> : null;
}
```

## กฎที่ห้ามละเมิด

1. **ทุก flag ต้องมีด่านที่ server** (`assertFeature`) ไม่ใช่แค่ซ่อน UI
2. **ไม่มีค่า = เปิด** flag ใหม่ต้องไม่ปิดของที่ ship แล้ว
3. **เก็บเฉพาะตัวที่ปิด** ใน jsonb
4. **อ่านตั้งค่าล้มเหลว = เปิด (หรือคงค่าเดิม)** ห้ามปิดทั้งแอปเพราะอ่าน DB ไม่ได้
5. **TTL สองฝั่งต้องใกล้กัน** และบอกผู้ใช้ admin ว่า "มีผลภายใน 1 นาที"
6. **ฟีเจอร์ที่ปิดต้องหายทั้งก้อน** รวม section สถานะ ประวัติ และเมนู

## บทเรียนจากของจริง

- **สวิตช์ที่ไม่ปิดอะไรเลย** รอบแรกที่ทำ มีแต่การเช็กใน UI — server function
  ยังเรียกได้ปกติ ซึ่งสำหรับ Google Places หมายถึงบิลที่ยังเดิน
- **client cache 5 นาที ทำให้สวิตช์ดูพัง** admin กดปิดแล้วเปิดหน้าอื่นก็ยังเห็นฟีเจอร์
  (React Query ไม่ refetch query ที่ยัง fresh) → ลดเป็น 30 วินาที + poll
- **เพิ่มคอลัมน์ `manual_url` ทำให้ flags ทั้งแผงอ่านว่า "เปิด"**
  เพราะ PostgREST ปฏิเสธ `select` ทั้งก้อนเมื่อคอลัมน์หนึ่งยังไม่มี (ดูไฟล์ 08)

## ลอกไปใช้อย่างไร

1. `FEATURE_FLAGS` เป็น `as const` ในโค้ด + `isEnabled()` ที่ถือกฎ "ไม่มี = เปิด"
2. คอลัมน์ jsonb หนึ่งคอลัมน์ เก็บเฉพาะตัวที่ปิด
3. `flags.server.ts` มี cache + fallback + `assertFeature`
4. วาง `assertFeature` เป็นบรรทัดแรกของทุก server fn ของฟีเจอร์นั้น
5. hook ฝั่ง client พร้อม staleTime/refetchInterval ใกล้กับ TTL ของ server
6. หน้า admin: สวิตช์ + ข้อความ "มีผลภายใน 1 นาที"
7. ทดสอบ: ปิดแล้วเรียก server fn ตรง ๆ ต้องได้ error ไม่ใช่ผลลัพธ์
