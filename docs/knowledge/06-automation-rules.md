# 06 · "กฎอัตโนมัติ" — rules engine ที่ admin ปรับได้ไม่ต้อง deploy

## ปัญหาที่แก้

ระบบมีงานเบื้องหลังจำนวนมากแบบ "ถ้า X ให้ทำ Y":
ยกงานค้างมาวันนี้, เตือนประกันใกล้หมด, เตือนแพ็กใกล้หมดอายุ, ระงับ AI เมื่อค้างจ่าย,
เตือนงบใช้เกิน 80%, ลบข้อมูลเก่าตามอายุ ฯลฯ

ตัวเลขในกฎพวกนี้ ("3 วัน", "80%", "48 ชั่วโมง") คือสิ่งที่ต้องปรับบ่อยที่สุด
แต่เป็นสิ่งที่ฝังในโค้ด — ปรับทีต้อง deploy ที

## โครงที่ใช้

### สิ่งที่ย้ายลงฐานข้อมูล: "รันไหม" + "ตัวเลข" — ไม่ใช่เงื่อนไข

> นี่ไม่ใช่ตัวสร้างเงื่อนไขแบบ generic การเก็บ query อิสระใน jsonb คือการสร้าง
> ภาษาคิวรีในคอลัมน์ — ทรงพลัง ทดสอบไม่ได้ และเป็นช่องให้ล้มเว็บจากฟอร์ม admin
> เงื่อนไขของแต่ละกฎจึงอยู่ในโค้ดที่มี type ที่อ่านและทดสอบได้
> สิ่งที่ย้ายลงฐานข้อมูลคือส่วนที่ถูกปรับจริง

```sql
CREATE TABLE public.automation_rules (
  key text NOT NULL UNIQUE,     -- ตรงกับ handler ใน cron.server.ts; key ที่ไม่รู้จักถูกข้าม
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"days": 3} / {"percent": 80}
  sort_order integer NOT NULL DEFAULT 100,     -- ลำดับในหน้า admin และลำดับที่ tick รัน
  last_run_at timestamptz,
  last_count integer,          -- กฎที่เงียบไปเองจะมองเห็นได้โดยไม่ต้องอ่าน log
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
```

### อ่านกฎ: fallback เป็น "ทำงานต่อด้วยค่าเดิม" เสมอ

```ts
// src/lib/rules.server.ts
export async function loadRules(): Promise<RuleSet> {
  const map: RuleSet = new Map();
  try {
    const { data, error } = await supabaseAdmin
      .from("automation_rules")
      .select("key, enabled, params")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    for (const r of data ?? [])
      map.set(r.key, { key: r.key, enabled: !!r.enabled, params: r.params ?? {} });
  } catch (err) {
    // อ่านตารางไม่ได้ (deploy พัง / ยังไม่ migrate) → ทุกกฎรันด้วยค่าที่ hard-code ไว้
    // เครื่องเตือนความจำที่เงียบเพราะตารางตั้งค่าหาย แย่กว่าเครื่องที่ไม่สนค่าปรับของ admin หนึ่งชั่วโมง
    console.warn("[rules] could not load, using code defaults:", err);
  }
  return map;
}

/** กฎที่ไม่มีแถว = เปิด — กฎใหม่ต้อง ship มาแบบทำงาน ไม่ใช่แบบปิด */
export function ruleEnabled(rules: RuleSet, key: string): boolean {
  const r = rules.get(key);
  return r ? r.enabled : true;
}

/** ตัวเลขจาก params หรือค่าที่โค้ดเขียนไว้ */
export function ruleNumber(rules: RuleSet, key: string, param: string, fallback: number): number {
  const raw = rules.get(key)?.params?.[param];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
```

### รันกฎ: ตารางของ [key, handler] หนึ่งชุด

```ts
// src/lib/cron.server.ts
const steps: Array<[string, () => Promise<number>]> = [
  ["reminders_rolled_over", () => rollOverReminders(now, rules)],
  [
    "ai_events_deleted",
    () =>
      deleteOlderThan(
        "ai_events",
        "created_at",
        cutoff(ruleNumber(rules, "ai_events_deleted", "days", AI_EVENT_RETENTION_DAYS) * DAY),
      ),
  ],
  ["checkin_missing", () => checkinMissing(now, rules)],
  ["premium_expiring", () => premiumExpiring(now, rules)],
  ["payg_overdue_suspend", () => paygOverdue(now)],
  ["budget_over_percent", () => budgetOverPercent(now, rules)],
  // …
];

for (const [key, step] of steps) {
  if (overBudget()) {
    summary["stopped_early_at"] = key;
    break;
  } // งบเวลาของ function
  // admin ปิดกฎ = ต้องไม่รัน ไม่ใช่แค่ซ่อนจากหน้าจอ
  if (!ruleEnabled(rules, key)) {
    summary[key] = -1;
    continue;
  }
  const count = await step();
  summary[key] = count;
  await recordRuleRun(key, count); // last_run_at + last_count
}
```

`summary` ทั้งก้อนถูกเขียนลง `cron_ticks` → ตอบได้ว่ารอบนั้นทำอะไรไปเท่าไหร่
และ `-1` หมายถึง "ถูกปิดอยู่" ซึ่งต่างจาก `0` ที่หมายถึง "รันแล้วไม่เจออะไร"

### seed ด้วยค่าเดิมเป๊ะ ๆ

```sql
INSERT INTO public.automation_rules (key, title, description, params, sort_order) VALUES
  ('reminders_rolled_over', 'ยกงานที่เลยกำหนดมาวันนี้',
   'งานที่เลยกำหนดเกินจำนวนวันที่ตั้งไว้ จะถูกยกมาเป็นวันปัจจุบัน', '{"days": 28}', 10),
  -- …
ON CONFLICT DO NOTHING;   -- ← redeploy ต้องไม่ทับค่าที่ admin ปรับไว้
```

**`ON CONFLICT DO NOTHING` สำคัญมาก:** seed คือค่าเริ่มต้น ไม่ใช่ค่าบังคับ
ถ้าใช้ `DO UPDATE` ทุก deploy จะล้างค่าที่ admin ตั้งไว้

### หน้า admin: ตัวเลขต้องมีป้ายบอกความหมาย

```tsx
// src/routes/_authenticated/admin_.rules.tsx
/** ความหมายของแต่ละพารามิเตอร์ เพื่อไม่ให้ admin แก้ตัวเลขที่ไม่มีป้าย */
const PARAM_LABELS: Record<string, string> = { days: "จำนวนวัน", percent: "เปอร์เซ็นต์", hours: "ชั่วโมง", ... };
```

หน้าแสดง `key` (เป็น `<code>`), title, description, สวิตช์ enabled,
ช่องตัวเลขของ `params` ทุกตัว, และ `last_run_at` / `last_count`

## กฎที่ห้ามละเมิด

1. **เงื่อนไขอยู่ในโค้ด ตัวเลขอยู่ในฐานข้อมูล** อย่าเก็บ query ใน jsonb
2. **ปิดกฎต้องหยุดรันจริง** เช็ก `ruleEnabled` ก่อนเรียก handler
3. **กฎที่ไม่มีแถว = เปิด** กฎใหม่ไม่ควรเงียบเพราะยังไม่ได้ seed
4. **อ่านตารางไม่ได้ ต้องรันด้วยค่า fallback** ห้ามหยุดทั้งระบบ
5. **seed ด้วย `ON CONFLICT DO NOTHING`** และต้องเป็นค่าเดิมที่ hard-code อยู่
   เพื่อให้ "apply migration แล้วพฤติกรรมไม่เปลี่ยน"
6. **บันทึกผลทุกรอบ** (`last_count`) ไม่งั้นกฎที่พังจะเงียบไปเป็นเดือน
7. **แยก "ปิดอยู่" ออกจาก "ไม่เจออะไร"** ใน summary

## บทเรียนจากของจริง

- **ข้อความราคาสัญญาว่าจะระงับ AI เมื่อค้างจ่าย PAYG แต่ไม่มีโค้ดบังคับเลย**
  กฎ `payg_overdue_suspend` ตั้ง `profiles.ai_suspended` และด่านโควตาอ่านค่านั้น
  **บทเรียน: คำสัญญาในหน้าราคาคือ requirement ตรวจทุกข้อว่ามีโค้ดจริง**
- **"ใช้เกิน 80% ของงบ" ไม่มีอะไรให้เทียบ** จนกว่าจะเพิ่ม `profiles.monthly_budget`
  — กฎที่อ้างถึงข้อมูลที่ไม่มีอยู่ ไม่เคยทำงาน แต่ก็ไม่เคย error
- **tick มีงบเวลา** (Netlify Functions) จึงต้องมี `overBudget()` และบันทึกว่า
  หยุดที่กฎไหน ไม่ใช่ปล่อยให้ถูกฆ่ากลางทางโดยไม่มีร่องรอย

## ลอกไปใช้อย่างไร

1. ตาราง `automation_rules` ตามด้านบน (key / enabled / params / sort_order / last_run_at / last_count)
2. `loadRules` + `ruleEnabled` + `ruleNumber` + `recordRuleRun` — สี่ฟังก์ชัน จบ
3. งานเบื้องหลังเขียนเป็นตาราง `[key, handler]` แล้ววนลูปพร้อมเช็ก enabled และงบเวลา
4. seed ค่าเดิมทั้งหมดด้วย `ON CONFLICT DO NOTHING`
5. หน้า admin: สวิตช์ + ช่องตัวเลขที่มีป้าย + ผลการรันล่าสุด
6. เขียน summary ลงตาราง log ของการรันแต่ละรอบ
