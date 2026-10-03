# 07 · การแจ้งเตือนทาง LINE

## ปัญหาที่แก้

ผู้ใช้ไทยอยู่ใน LINE ไม่ได้อยู่ในแอปเรา การแจ้งเตือนที่อยู่แค่ในแอปจึงไม่ถึงคน
แต่ LINE Messaging API มีข้อจำกัดที่ทำให้ "ยิง push ตอนเกิดเหตุ" ใช้ไม่ได้:

- **โควตารายเดือน** แผนฟรี/เริ่มต้นมีจำนวนข้อความจำกัด ยิงหมดแล้วเงียบทั้งระบบ
- ต้องเป็น **เพื่อน** กับ OA ก่อนจึงจะส่งได้ (และผู้ใช้อาจบล็อกทีหลัง)
- **401/403** = token ตาย, **429** = โควตาหมด, **5xx** = ต้องลองใหม่ — คนละการจัดการ
- ถ้ายิงใน request handler ของผู้ใช้ ทุกการกระทำจะมี HTTP call ไป LINE ติดอยู่ด้วย

## โครงที่ใช้

### แยก "เขียนการแจ้งเตือน" ออกจาก "ส่ง" ด้วยคิว

```
การกระทำของผู้ใช้
   └─ notifyUsers() / notifyAdmins() / notifyJobParties()   ← ฝั่ง request (เร็ว)
        ├─ INSERT app_notifications   → จุดแดงในแอป + หน้าแจ้งเตือน (ทำงานเสมอ)
        ├─ INSERT notification_log    → คิวสำหรับ LINE (channel="line", status="queued")
        └─ deliverWebhooks()          → ใครตั้ง webhook ไว้ก็ได้ของชุดเดียวกัน

scheduled tick (ทุก n นาที)
   └─ line-deliver.server.ts          ← ฝั่งเบื้องหลัง (ช้าได้)
        ├─ เช็กโควตา / token / halt
        ├─ เช็กความเป็นเพื่อน (cache 1 ชม.)
        ├─ push เป็น batch 20
        └─ อัปเดต status: sent / skipped / failed (+ attempts)
```

```ts
// src/lib/notify.server.ts
export async function notifyUsers(userIds, n: Notice, actorUserId?): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))].filter((u) => u !== actorUserId);
  if (ids.length === 0) return 0;

  const { data: written, error } = await supabaseAdmin
    .from("app_notifications")
    .insert(
      ids.map((uid) => ({
        user_id: uid,
        kind: n.kind,
        title: n.title,
        body: n.body,
        href: n.href,
        ref_table: n.refTable ?? null,
        ref_id: n.refId ?? null,
        params: n.params ?? {},
      })),
    )
    .select("id, user_id");
  // การแจ้งเตือนที่ล้มเหลว ต้องไม่ทำให้การกระทำที่ทำให้มันเกิดล้มเหลว:
  // เงินก็โอนไปแล้ว ข้อความก็ส่งไปแล้ว
  if (error) {
    console.error("[notify] insert failed:", error.message);
    return 0;
  }

  await queueForLine(written ?? [], n); // คิว LINE
  const { deliverWebhooks } = await import("./webhooks.server");
  await deliverWebhooks(ids, n);
  return ids.length;
}
```

**สองข้อที่ต้องสังเกต:**

1. `.filter((u) => u !== actorUserId)` — ไม่แจ้งคนที่เป็นคนทำเอง
2. ข้อความถูก **คัดลอก** ลงแถวคิว ไม่ใช่ join กลับไปอ่าน `app_notifications`
   เพราะแถวคิวต้องรอดจากการล้างข้อมูลเก่า และข้อความที่ส่งไปแล้ว
   ควรบอกสิ่งที่มันบอกตอนนั้น

### การ์ดต้องตอบ ใคร/อะไร/เมื่อไหร่ ได้ในตัวเอง

การแจ้งเตือนในแอปเป็นแค่ "ตัวชี้" (กดแล้วไปอ่านต่อ) แต่การ์ด LINE ไม่ใช่
มันไปโผล่บนมือถือของคนที่อาจไม่เปิดแอปทั้งวัน

```ts
// src/lib/notice-detail.ts — body = บรรทัดสรุป + บรรทัด "ป้าย: ค่า"
noticeBody("ทดสอบ LINE", [
  ["ผู้มอบหมาย", "พี่ต้น"],
  ["กำหนดส่ง", whenTH(dueAt)], // "ศ. 3 ต.ค. 2569 14:30 น." — พ.ศ. · กรุงเทพ · 24 ชม.
  ["ความสำคัญ", PRIORITY_TH[priority]],
]);
```

```ts
// src/lib/line-flex.ts — แปลงกลับเป็นแถวสองคอลัมน์ในการ์ด Flex
const parts = parseNoticeBody(n.body).slice(0, 8);
const contents = parts.map((p) =>
  p.label ? row(p.label, clip(p.value, 120)) : text(clip(p.value, 300), { size: "sm" }),
);
// altText ต้องมีรายละเอียดด้วย — มันคือสิ่งที่โผล่บน lock screen
altText: clip(
  parts.length
    ? `${n.title} — ${parts.map((p) => (p.label ? `${p.label} ${p.value}` : p.value)).join(" · ")}`
    : n.title,
  400,
);
```

เก็บเป็น "ข้อความ" ไม่ใช่คอลัมน์ใหม่ → ไม่ต้องแก้ schema และ
**แอป · การ์ด LINE · webhook ใช้ข้อความชุดเดียวกัน** ไม่มี source of truth ที่สอง

### ด่านโควตา: ตัวที่กันระบบไม่ให้เงียบทั้งเดือน

```
used      = max(จำนวนแถวที่ส่งเดือนนี้ใน notification_log, totalUsage จาก LINE)
digest หยุดที่  cap - reserve        immediate หยุดที่  cap
```

- ตัวเลขของ LINE อาจตามหลัง (ตาม docs) แต่ log ของเราไม่ตาม — เอาค่าที่มากกว่า
  เพื่อเอนไปทาง "ไม่ส่ง" เมื่อไม่แน่ใจ
- `cap` / `reserve` อยู่ใน `notification_settings` → admin ปรับได้ไม่ต้อง deploy
- กันที่สำรองไว้ให้ digest ตอนเช้า เพราะมันคือข้อความที่ "สำคัญน้อยกว่าแต่พลาดไม่ได้"

### การจัดการ error ต่อหนึ่ง push (ตาม docs ของ LINE)

| สถานะ               | การจัดการ                                                                 |
| ------------------- | ------------------------------------------------------------------------- |
| 401 / 403 auth      | token ผิด → **หยุดทั้งระบบ 6 ชม.** + เขียน `ai_events` ให้ admin เห็น     |
| 400 target          | user id ใช้กับ channel นี้ไม่ได้ → mark blocked **ไม่ retry อีก**         |
| 429 "monthly"       | โควตาหมด → mark skipped + `ai_events` + หยุด tick นี้                     |
| 5xx / network / 429 | retry ได้ → `attempts + 1`, tick ถัดไปลองใหม่, เกิน MAX_ATTEMPTS = failed |
| 409                 | LINE รับ `X-Line-Retry-Key` นี้ไปแล้ว → **นับว่าส่งสำเร็จ**               |
| 200 แต่ถูกบล็อก     | LINE ตอบ 200 แม้ผู้ใช้บล็อก (ไม่ส่งจริง ไม่นับโควตา) — ยอมรับได้          |

```ts
export const MAX_ATTEMPTS = 3;
const HALT_HOURS = 6;
// เช็กเพื่อนเก่ากว่านี้ให้เช็กใหม่ก่อน push: คนที่เพิ่งแอดเป็นเพื่อนจะถูกจับได้ภายในชั่วโมง
const FRIEND_CHECK_TTL_MS = 60 * 60_000;
const DELIVER_BATCH = 20;
```

### ปุ่มในการ์ดต้องเปิดเบราว์เซอร์จริง

```ts
// src/lib/line-push.server.ts
export function appOpenUrl(path = "/today"): string {
  const liff = process.env["LINE_LIFF_ID"];
  return liff
    ? `https://liff.line.me/${liff}${path}`
    : // openExternalBrowser=1 คือพารามิเตอร์ที่ LINE มีให้สำหรับเปิดเบราว์เซอร์ของเครื่อง
      // เบราว์เซอร์ในแอป LINE ทำบางฟีเจอร์พัง (เคยเจอกับเจ้าของโปรเจกต์)
      `https://lavieos.netlify.app${path}?openExternalBrowser=1`;
}
```

### การผูกบัญชี LINE (LINE Login)

```
startLink   → สร้างแถว state ผูกกับผู้ใช้ที่ล็อกอิน (อายุ 10 นาที) → คืน authorize URL
finishLink  → state ต้องมีจริง ยังไม่หมดอายุ และ "เป็นของผู้เรียก"
              (state ที่ออกให้บัญชีอื่นถูกปฏิเสธ = กัน login CSRF)
            → code → token → verify ID token กับ LINE → sub
            → เช็กความเป็นเพื่อนด้วย access token ของผู้ใช้ แล้ว revoke token นั้น
            → upsert line_links
```

เบราว์เซอร์ส่งต่อแค่ `code` และ `state` — secret อยู่ฝั่ง server เท่านั้น
`redirect_uri` ต้องตรงกับที่ลงทะเบียนใน LINE Login channel แบบเป๊ะ ๆ
(โครงการนี้ลงทะเบียน production + `http://localhost:5173`)

### ทดสอบการ์ดฟรี

`POST /v2/bot/message/validate/push` ตรวจรูปแบบข้อความได้โดยไม่ส่งและไม่นับโควตา

## กฎที่ห้ามละเมิด

1. **อย่า push ใน request ของผู้ใช้** เขียนคิวแล้วให้งานเบื้องหลังส่ง
2. **คัดลอกข้อความลงแถวคิว** ไม่ใช่ join กลับไปอ่านภายหลัง
3. **การแจ้งเตือนล้มเหลว ห้ามทำให้การกระทำต้นทางล้มเหลว**
4. **ไม่แจ้งคนที่เป็นผู้ลงมือเอง**
5. **การ์ดต้องตอบ ใคร/อะไร/เมื่อไหร่** และ `altText` ต้องมีรายละเอียดด้วย
6. **แยกการจัดการ error ตามชนิด** auth = หยุด, target = ไม่ retry, 5xx = retry
7. **เพดานโควตาอยู่ใน settings** และเผื่อที่สำรองไว้ให้ข้อความประจำวัน
8. **มีที่เดียวที่เขียนการแจ้งเตือนต่อหนึ่งเหตุการณ์** (ดูบทเรียนข้างล่าง)

## บทเรียนจากของจริง

- **ข้อความใหม่ในงานขึ้นสองรายการ** เพราะมีคนเขียนการแจ้งเตือนสองที่:
  database trigger บนตาราง `job_messages` (เขียนแค่ตัวข้อความ ไม่เข้าคิว LINE)
  และ server function ที่เพิ่มทีหลัง (เขียนแบบละเอียด + เข้าคิว LINE)
  **บทเรียน: หนึ่งเหตุการณ์ = หนึ่งที่เขียน ถ้าย้ายจาก trigger มาเป็นโค้ด ต้องลบ trigger**
- **การแจ้งเตือนหลายสิบชนิดเขียนไม่ลงเลย** `app_notifications.kind` มี CHECK
  จำกัดไว้ 8 ค่าตั้งแต่สร้างตาราง แต่โค้ดเขียน `family_task`, `funeral_review` ฯลฯ
  → Postgres ปฏิเสธทุกแถว และผู้เรียกไม่ตรวจ error จึงเงียบสนิท
  **บทเรียน: CHECK บน enum ที่โตเรื่อย ๆ คือกับดัก — ใช้ `length(btrim(kind)) > 0` แทน
  และ**ทุกการเขียนต้องตรวจ error**
- **การ์ดบอกน้อยเกินไป** "งานครอบครัวที่มอบหมายให้คุณ / ทดสอบ LINE" ไม่บอกว่าใครสั่ง
  หรือกำหนดเมื่อไหร่ → เกิด `notice-detail.ts` ขึ้นมาเพื่อให้ทุกชนิดบอกครบ
- **ผู้รับงานไม่เคยรู้ว่าข้อเสนอถูกตอบรับ** ฟังก์ชันแจ้งเตือนอ่าน `assigned_helper_id`
  ซึ่ง client เขียน _หลัง_ เรียกแจ้งเตือน → หาผู้รับไม่เจอ
  **บทเรียน: ส่ง id ผู้รับเข้าไปตรง ๆ ถ้ารู้อยู่แล้ว อย่าให้ไปค้นจากสถานะที่กำลังเปลี่ยน**

## ลอกไปใช้อย่างไร

1. ตาราง `app_notifications` (ในแอป) + `notification_log` (คิวส่งออก มี
   `channel`, `status`, `attempts`, unique ต่อการแจ้งเตือนหนึ่งใบ)
2. `notify*()` ชุดเดียวที่ทุก feature เรียก — เขียนในแอป + เข้าคิว + webhook ในฟังก์ชันเดียว
3. ตัวสร้างข้อความแบบ "สรุป + ป้าย: ค่า" (`noticeBody`/`parseNoticeBody`)
   ใช้ร่วมกันทั้งในแอป การ์ด และ webhook
4. งานเบื้องหลังหนึ่งตัว: โควตา → เพื่อน → push เป็น batch → อัปเดตสถานะ/attempts
5. ตาราง `notification_settings` สำหรับ cap / reserve / ชั่วโมง digest / halt
6. เขียน error handling ตามตารางข้างบนตั้งแต่วันแรก — มันคือครึ่งหนึ่งของงานทั้งหมด
