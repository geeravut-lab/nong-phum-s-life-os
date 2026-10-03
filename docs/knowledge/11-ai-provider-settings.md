# 11 · ตั้งค่า AI: สถานะปัจจุบัน · หลัก/สำรอง · โมเดลแยกตามงาน · เหตุการณ์ AI

## ปัญหาที่แก้

แอปที่เรียก LLM ต้องตอบคำถามเหล่านี้ได้ **จากหน้า admin ไม่ใช่จากการอ่านโค้ด**:

- ตอนนี้ใช้เจ้าไหน รุ่นอะไร และใครแก้ล่าสุด
- ถ้าเจ้าหลักล่ม จะไปต่อที่ไหน
- งานแต่ละชนิด (แชท / อ่านเอกสาร / คิดวิเคราะห์) ควรใช้รุ่นต่างกัน
- เมื่อวานมี fallback หรือ error อะไรเกิดขึ้น

และต้องเปลี่ยนได้โดยไม่ deploy เพราะ **ชื่อรุ่นโมเดลเปลี่ยนและหายบ่อยกว่าโค้ดของเรา**

## โครงที่ใช้

### ลำดับการตัดสิน: ฐานข้อมูล → environment → ค่าในโค้ด

```
ai_settings (admin แก้ได้)  →  AI_PROVIDER / AI_FALLBACK_PROVIDER (env)  →  PROVIDERS ในโค้ด
```

ทุกชั้นมี fallback ลงชั้นถัดไป ชั้นล่างสุดคือค่าในโค้ดที่ทำงานได้แน่นอน

```ts
// src/lib/ai-provider.server.ts
export type ProviderId = "anthropic" | "openai" | "google";
/** งานต่างกันคุ้มกับโมเดลต่างขนาด: แชทบ่อยและถูก เอกสารต้องเห็นภาพ */
export type TaskKind = "chat" | "document" | "reasoning";

type ProviderConfig = {
  envKey: string;
  models: Record<TaskKind, string>;
  capabilities: { pdf: boolean; audio: boolean };
  create: (apiKey: string) => (modelId: string) => LanguageModel;
};
```

### ตาราง `ai_settings` (แถวเดียว) + `ai_events`

```ts
export type AiSettingsRow = {
  default_provider: string | null; // null = ใช้ค่าจาก environment
  fallback_provider: string | null; // "none" = ปิด fallback
  model_overrides: ModelOverrides; // { anthropic: { chat: "…" }, … }
  updated_at: string;
  updated_by: string | null; // ← หน้า admin แสดง "แก้ล่าสุดโดย"
};
```

```ts
// ai_events: บันทึก "เฉพาะ fallback และ error" ไม่เคยบันทึกการเรียกที่สำเร็จ
export type AiEvent = {
  provider: ProviderId | string;
  task: TaskKind | "config";
  status: "fallback" | "error";
  error_code?: string | null;
  message?: string | null;
};

/** best-effort: การเขียน log ล้มเหลว ต้องไม่กลบ error ที่กำลังจะ log */
export async function logAiEvent(event: AiEvent): Promise<void> {
  try {
    /* insert */
  } catch (err) {
    console.error("[ai] could not write ai_events", err);
  }
}
```

เก็บแต่ fallback/error เพราะ: การเรียกที่สำเร็จมีเป็นหมื่น และไม่มีอะไรให้ดู
ส่วนตัวนับการใช้ที่ต้องการอยู่ใน `ai_usage_monthly` แล้ว (ดูไฟล์ 10)

### cache 30 วินาที และ "สัญญา" กับหน้า admin

```ts
// 30 วินาทีคือข้อตกลงที่ทำกับหน้า admin ("การเปลี่ยนแปลงมีผลภายใน 1 นาที")
// แต่ละ instance ของ Functions ถือสำเนาของตัวเอง — TTL ยาวกว่านี้จะทำให้สอง
// instance ไม่ตรงกันนานขึ้น สั้นกว่านี้จะใส่ DB read หน้าเกือบทุก AI call
// ไม่มีการ invalidate ข้าม instance — TTL คือหลักประกันเดียวว่าจะมาบรรจบกัน
const SETTINGS_TTL_MS = 30_000;
```

### guard ตอน runtime: ตั้งค่าไว้แต่ key หาย

```ts
export async function resolveProvider(task: TaskKind | "config" = "config"): Promise<ProviderId> {
  const settings = await getAiSettings();
  const fromDb = settings?.default_provider;
  if (isProviderId(fromDb)) {
    if (apiKeyFor(fromDb)) return fromDb;
    // หน้า admin ไม่ให้บันทึก provider ที่ไม่มี key แต่ key ถูกถอดออกจาก env ทีหลังได้
    // กรณีนั้นให้ถอยไปใช้ provider จาก environment และบันทึก ai_events
    // ดีกว่าทำ request ของผู้ใช้ล้มเพราะปัญหาการตั้งค่า
    const envProvider = resolveProviderFromEnv();
    if (now - lastGuardLogAt > SETTINGS_TTL_MS) {
      // ← หนึ่งแถวต่อหนึ่ง cache window
      lastGuardLogAt = now;
      await logAiEvent({
        provider: fromDb,
        task,
        status: "error",
        error_code: "missing_api_key",
        message: "…",
      });
    }
    return envProvider;
  }
  return resolveProviderFromEnv();
}
```

`lastGuardLogAt` สำคัญ: guard นี้ยิงได้ทุก AI call ตลอดเวลาที่ตั้งค่าผิด
ถ้าไม่จำกัด `ai_events` จะเต็มด้วยแถวเดียวกันเป็นพัน

### fallback: ลองใหม่ครั้งเดียว และเลือกว่า error แบบไหนคุ้ม

```ts
/**
 * error แบบไหนคุ้มกับโควตาของ provider สำรอง
 * 429/5xx/network = ชั่วคราว
 * 401/403 รวมด้วย: แปลว่า key ของเจ้าหลักตายหรือถูกเพิกถอน ซึ่งเป็นจังหวะที่
 *   provider ที่สองทำให้แอปยังใช้ได้ — และทุกการสลับถูก log ไว้ key ที่พังจึงไม่ถูกซ่อน
 * 4xx อื่น (400, 404, 422) = คำขอหรือชื่อโมเดลของเราเองผิด จะพังเหมือนกันบน
 *   เจ้าสำรอง จึงไม่คุ้มที่จะเรียกครั้งที่สอง
 */
function shouldTryFallback(error: unknown): boolean {
  const status = (error as any)?.statusCode ?? (error as any)?.status;
  if (typeof status === "number")
    return status === 429 || status === 401 || status === 403 || status >= 500;
  const name = (error as any)?.name ?? "";
  const message = (error as any)?.message ?? "";
  return /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed/i.test(`${name} ${message}`);
}
```

```ts
export async function withProviderFallback<T>(task, call): Promise<T> {
  const primary = await resolveProvider(task);
  try {
    const result = await call(await modelFor(primary, task));
    void recordTokens(task, primary, result);        // ← เก็บ token ไว้คิดต้นทุน
    return result;
  } catch (error) {
    const fallback = await resolveFallbackProvider();
    if (!fallback || fallback === primary || !shouldTryFallback(error)) {
      await logAiEvent({ provider: primary, task, status: "error", … });
      throw error;
    }
    if (!apiKeyFor(fallback)) { /* log + rethrow error เดิม */ }
    await logAiEvent({ provider: primary, task, status: "fallback", … });
    try {
      const result = await call(await modelFor(fallback, task));
      void recordTokens(task, fallback, result);
      return result;
    } catch (fallbackError) {
      await logAiEvent({ provider: fallback, task, status: "error",
                         message: `fallback also failed: …` });
      throw fallbackError;
    }
  }
}
```

ทุก AI call ในแอปห่อด้วยฟังก์ชันนี้ตัวเดียว

### ตรวจตอน boot ไม่ใช่ตอนผู้ใช้กดปุ่ม

```ts
/**
 * โยน error เว้นแต่ environment เพียว ๆ ใช้งานได้: provider ที่ env เลือกมี key
 * และ fallback ที่ env เลือก (ถ้ามี) ชี้ไป provider ที่มีจริง
 *
 * เรียกจาก src/server.ts เพื่อให้ deploy ที่ตั้งค่าผิดตายตอน startup
 * ไม่ใช่ตอนผู้ใช้คนแรกกดปุ่ม
 *
 * มันเป็น module side-effect เปล่า ๆ ไม่ได้: โมดูลนี้ถูก import แบบ lazy
 * และ package.json ประกาศ "sideEffects": false — import-for-effect อาจถูกตัดทิ้ง
 */
export function assertAiProviderConfig(): void { … }
```

### รายการโมเดลจาก API จริง ไม่ใช่พิมพ์เอง

`src/lib/ai-models.server.ts` เรียก list endpoint ของแต่ละเจ้า
(cache 1 ชั่วโมง, ถ้าเรียกไม่ได้ใช้รายการในโค้ด) เพื่อให้ admin **เลือก**
จากสิ่งที่เจ้านั้นเสิร์ฟจริง ไม่ใช่พิมพ์ ID ที่ 404 ตอน runtime

ข้อควรระวังที่ค้นพบ: base URL ต้องตรงกับที่ AI SDK จะเรียกจริง
(`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`) ไม่งั้น token ที่ใช้ได้กับ chat
จะได้ 401 จาก host สาธารณะของเจ้านั้น

### ปุ่ม "ทดสอบ" ข้างทุกช่องโมเดล

`testAiModel` ยิง prompt สั้น ๆ ไปที่ provider+model ที่เลือกจริง แล้วตอบ
"ใช้ได้ / ใช้ไม่ได้" — ตรวจก่อนบันทึก ไม่ใช่รอให้ผู้ใช้เจอ

### หน้า admin สี่ส่วน

| ส่วน                       | แสดงอะไร                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------- |
| **สถานะปัจจุบัน**          | provider ที่ใช้อยู่ · รุ่นที่ใช้อยู่ต่อ task · แก้ล่าสุดเมื่อ/โดยใคร                |
| **ผู้ให้บริการหลัก/สำรอง** | dropdown + ป้าย "ไม่มี API key" + ตัวเลือก "ใช้ค่าจาก environment" / "ปิด fallback" |
| **รุ่นโมเดลแยกตามงาน**     | ช่องต่อ provider × task + ปุ่มทดสอบ + ป้ายว่ารายการมาจาก API หรือโค้ด               |
| **เหตุการณ์ AI ล่าสุด**    | 50 แถวล่าสุดจาก `ai_events` (เฉพาะ fallback/error)                                  |

## กฎที่ห้ามละเมิด

1. **สามชั้นเสมอ: DB → env → โค้ด** และชั้นล่างสุดต้องใช้งานได้จริง
2. **อ่านตั้งค่าล้มเหลว = คงค่าเดิม** ไม่ใช่ทำให้ฟีเจอร์ AI ล่มตาม DB
3. **บันทึกแต่ fallback และ error** และจำกัดอัตราแถวซ้ำ
4. **fallback ลองครั้งเดียว** และเลือกตามชนิด error
5. **ห่อ AI call ทุกจุดด้วยฟังก์ชันเดียว** (`withProviderFallback`)
6. **เขียนไว้ในคอมเมนต์ว่า ID โมเดลถูกตรวจเมื่อไหร่ที่ไหน** พร้อมลิงก์เอกสาร
   — มันจะล้าสมัยเร็วกว่าโค้ดรอบตัวมันหลายเท่า
7. **ตรวจ config ตอน boot** และบอกใน error ว่าเจ้าไหนมี key อยู่

## บทเรียนจากของจริง

- **default ของงาน reasoning เคยเป็นรุ่นแพงสุด** การเรียกหนึ่งครั้ง ~4k in / 1.2k out
  = ฿1.32 บน Opus แต่ ฿0.53 บน Sonnet ขณะที่ PAYG เก็บ ฿0.50 → ขายต่ำกว่าทุนทุกครั้ง
  **บทเรียน: default ไม่ควรเป็นรุ่นแพงที่สุดในแคตตาล็อก ให้ admin เลือกขึ้นเองได้**
- **เอกสารของ Gemini กับ API จริงไม่ตรงกัน และ API ชนะ** จากการ probe ด้วย key
  ของโครงการเอง: `3.8-flash` 429 ตลอด, `2.5-pro` 404 "ไม่ให้ผู้ใช้ใหม่แล้ว",
  ทุกรุ่น Pro 429 เพราะ free tier ไม่มีโควตา Pro เลย → เลือก `3.7-flash`
  **บทเรียน: ทดสอบ ID จริงด้วย key ของตัวเอง แล้วเขียนผลไว้ในคอมเมนต์**
- **Gemini เป็นเจ้าเดียวที่รับ audio inline** ความสามารถต่างกันต่อเจ้า
  จึงต้องมี `capabilities` ในตารางให้โค้ดเลือกเส้นทางได้
- **โมเดล structured output มีข้อจำกัดต่างกัน** Gemini ปฏิเสธ `maxItems`
  และ enum ที่ซ้อนใน object ของ array → schema ที่ใช้ได้กับเจ้าหนึ่งพังกับอีกเจ้า
  **บทเรียน: schema ของ structured output ต้องทดสอบกับทุกเจ้าที่ตั้งเป็น fallback**

## ลอกไปใช้อย่างไร

1. ตาราง `PROVIDERS` ในโค้ด: envKey, models ต่อ task, capabilities, factory
2. ตาราง `ai_settings` แถวเดียว (default/fallback/model_overrides/updated_by)
   - `ai_events` (fallback/error เท่านั้น)
3. `resolveProvider` / `resolveModelId` แบบสามชั้น + guard เมื่อ key หาย
4. `withProviderFallback` หนึ่งตัว ห่อทุก call + บันทึก token เพื่อคิดต้นทุน
5. `assertAiProviderConfig()` เรียกจาก entry ของ server
6. list โมเดลจาก API ของเจ้านั้น + ปุ่มทดสอบข้างทุกช่อง
7. หน้า admin สี่ส่วนตามตารางข้างบน พร้อมข้อความ "มีผลภายใน 1 นาที"
