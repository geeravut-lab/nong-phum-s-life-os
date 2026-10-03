# 13 · "ขอสำเนาข้อมูลของฉัน" และ "ลบบัญชี" (PDPA)

## ปัญหาที่แก้

PDPA (และ GDPR) ขอสองอย่างคู่กัน: ขอสำเนาข้อมูล และลบข้อมูล
ของจริงมีรายละเอียดที่ลืมกันทุกครั้ง:

- ตารางที่ถือข้อมูลของผู้ใช้ **ไม่ได้ใช้ชื่อคอลัมน์เดียวกันทั้งหมด**
- ไฟล์ใน storage ฐานข้อมูลไม่รู้จัก cascade จึงลบไม่ได้
- แถวของ "คนอื่น" ที่ผูกกับผู้ใช้นี้ (ครอบครัวที่เขาเป็นเจ้าของ) ต้องจัดการก่อนลบ
- รายการการจ่ายเงินต้องอยู่ต่อเพื่อทำบัญชี แต่ต้องไม่ผูกกับคนที่ลบไปแล้ว

## โครงที่ใช้ — ฝั่ง export

### รายการตาราง + คอลัมน์เจ้าของ ตรวจจาก types จริง

```ts
// src/lib/export.functions.ts
/**
 * ทุกตารางที่ถือแถวของผู้ใช้คนหนึ่ง พร้อมคอลัมน์ที่เป็นเจ้าของ
 * ตรวจกับ generated types ไม่ใช่เดา — คอลัมน์เจ้าของไม่ใช่ user_id เสมอ
 * (job_offers คีย์ที่ผู้ช่วย, ตาราง death/memorial คีย์ที่ตัวบุคคล)
 */
const OWNED_TABLES = [
  { table: "profiles", col: "id" },
  { table: "documents", col: "user_id" },
  { table: "job_offers", col: "helper_user_id" }, // ← ไม่ใช่ user_id
  { table: "death_cases", col: "subject_user_id" }, // ← ก็ไม่ใช่
  { table: "memorials", col: "subject_user_id" },
  // … 30 ตาราง
] as const;
```

### ผลลัพธ์: JSON ก้อนเดียว + manifest, ไฟล์เป็นลิงก์

```ts
export type ExportManifest = {
  generatedAt: string;
  userId: string;
  email: string | null;
  tables: Record<string, number>; // ตาราง → จำนวนแถว
  files: number;
  skipped: Record<string, string>; // ตารางที่อ่านไม่ได้ + เหตุผล
};
```

> ไฟล์ใน storage ถูกแสดงเป็น path + signed url ไม่ได้ฝังลงไป
> เพื่อให้ export ยังเป็น "เอกสาร" ไม่ใช่ payload หลายร้อยเมกะไบต์

**`skipped` สำคัญ:** ถ้าตารางหนึ่งอ่านไม่ได้ ต้องบอกในไฟล์ว่าขาดอะไรไป
ไม่ใช่ส่งไฟล์ที่ดูครบแต่ไม่ครบ

### ดาวน์โหลดใน browser — ไม่เก็บไฟล์ไว้ฝั่ง server

```ts
// src/components/ExportDataCard.tsx
const res = (await run()) as { filename: string; json: string };
// เขียนใน browser จึงไม่ต้องเก็บ export ไว้ฝั่ง server เลย
const blob = new Blob([res.json], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = res.filename;
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(url);
```

สำเนาข้อมูลส่วนบุคคลที่นอนอยู่บน server คือภาระด้านความปลอดภัยที่ไม่จำเป็น

ส่ง JSON กลับเป็น **สตริง** ไม่ใช่ object ซ้อน เพราะ payload คือ row shape
อิสระซึ่ง server-function boundary type เป็น serializable ไม่ได้
และ client ต้องการแค่ text เพื่อเขียนไฟล์

### export ก็ต้องลง audit log

```ts
await supabaseAdmin.from("privacy_audit_log").insert({
  user_id: uid,
  action: "data_export",
  detail: `exported ${totalRows} rows, ${files.length} files`,
  meta: { tables: Object.keys(counts).length, files: files.length },
});
```

การขอสำเนาต้องตรวจสอบย้อนหลังได้เท่ากับการลบ

## โครงที่ใช้ — ฝั่ง delete

### cascade ทำได้แค่บางส่วน — สามอย่างที่มันทำไม่ได้

```ts
// src/lib/account.server.ts
// cascade (migration ของ PDPA) ลบทุกแถวที่ผู้ใช้เป็นเจ้าของเมื่อ auth.users เสียแถวไป
// โมดูลนี้ทำสามอย่างที่ cascade ทำไม่ได้:
//   1. บอกผู้ใช้ล่วงหน้าว่าอะไรจะหายไป รวมครอบครัวที่เขาเป็นเจ้าของและใครอยู่ในนั้น
//   2. เคลียร์ flag การแชร์บนแถวของ "สมาชิกคนอื่น" ก่อนครอบครัวจะถูกยุบ
//      — cascade ตั้ง family_id = NULL แต่ปล่อย is_shared = true ไว้
//      ซึ่งจะทำให้แถวเหล่านั้นบรรยายตัวเองผิดไปตลอดกาล
//   3. ลบไฟล์ของผู้ใช้ใน storage ซึ่ง Postgres ไม่รู้จัก
// และเขียน audit หนึ่งแถวก่อนผู้ใช้จะหายไป
```

### ลำดับการลบ — ผิดลำดับแล้วกู้ไม่ได้

```ts
/**
 *   a. เลิกแชร์แถวของสมาชิกคนอื่นในครอบครัวที่ผู้ใช้นี้เป็นเจ้าของ
 *      (ใช้ service role: มันไม่ใช่แถวของผู้ใช้นี้) — ก่อน cascade ยุบครอบครัว
 *   b. ลบไฟล์ของผู้ใช้ใน storage (Postgres ทำไม่ได้)
 *   c. เขียนแถว audit
 *   d. auth.admin.deleteUser — cascade เก็บทุกแถวที่เป็นเจ้าของจากจุดนี้
 * ถ้า (a) หรือ (b) ล้ม บัญชีจะยังอยู่ครบ ผู้เรียกลองใหม่ได้
 */
```

เหตุผลที่ `d` ต้องอยู่ท้าย: หลังจากนั้น **ไม่มีทางรู้ได้แล้ว** ว่าเคยมีไฟล์อะไร
หรือครอบครัวไหนที่ต้องเคลียร์ — ข้อมูลที่ต้องใช้หายไปพร้อมแถว

### บอกก่อนลบ ด้วยจำนวนจริง

```ts
export type DeletionPreview = {
  counts: Record<(typeof OWNED_TABLES)[number], number>; // 9 ตารางหลัก แยกรายการ
  /** ทุกอย่างใน OTHER_OWNED_TABLES และ OWNER_TABLES รวมเป็นเลขเดียว */
  otherRows: number;
  storageFiles: number;
  /** ครอบครัวที่ผู้ใช้นี้เป็นเจ้าของ — ลบบัญชีแล้วแต่ละวงจะถูกยุบ */
  ownedFamilies: OwnedFamily[]; // { id, name, otherMembers }
  /** ครอบครัวที่เป็นสมาชิกเฉย ๆ — แค่ออกจากวง */
  memberOfFamilies: number;
  isSsoUser: boolean;
  isLineLinked: boolean;
  donations: number;
};
```

> รวมที่เหลือเป็นเลขเดียว: ไดอะล็อกบอกว่า "และอีก n รายการ" ซึ่งซื่อสัตย์
> โดยไม่ทำให้หน้ายืนยันกลายเป็นทัวร์ schema

อ่าน preview ด้วย client ของผู้ใช้เอง (ติด RLS) ไม่ใช่ service role —
ตัวเลขที่ผู้ใช้เห็นจึงเป็นตัวเลขของสิ่งที่เขาเห็นได้จริง

### ยืนยันด้วยการพิมพ์ และตรวจสองชั้น

```ts
export const DELETE_CONFIRMATION_PHRASES = ["ลบบัญชี", "DELETE"] as const;
```

```ts
// ฝั่ง UI: ปุ่ม disabled จนกว่าจะตรงกัน
const phrase = lang === "en" ? DELETE_CONFIRMATION_PHRASES[1] : DELETE_CONFIRMATION_PHRASES[0];
const confirmed = (DELETE_CONFIRMATION_PHRASES as readonly string[]).includes(typed.trim());
// ฝั่ง server: ตรวจวลีซ้ำอีกครั้ง — UI ไม่ใช่ด่านความปลอดภัย
```

หลังลบสำเร็จ: `supabase.auth.signOut({ scope: "global" })` — ออกทุกเครื่อง
(ต่างจาก sign out ปกติที่ใช้ `scope: "local"` เพื่อไม่ให้ออกจากเครื่องอื่นของตัวเอง)

### ไฟล์ใน storage ต้องวนทีละหน้า

```ts
async function listUserFiles(userId: string): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin.storage
      .from("documents")
      .list(userId, { limit: 1000, offset });
    if (error) throw error;
    if (!data?.length) break;
    for (const f of data) out.push(`${userId}/${f.name}`);
    if (data.length < 1000) break;
    offset += data.length;
  }
  return out;
}
```

`list` คืนได้มากสุด 1000 — ไม่วน ไฟล์ที่ 1001 ขึ้นไปจะค้างอยู่ตลอดกาล

### การจ่ายเงินอยู่ต่อเป็น ledger

```ts
// การจ่ายเงินอยู่ได้นานกว่าบัญชีที่ทำมัน: แถวถูกเก็บไว้เป็นรายการบัญชี
// โดย user_id ถูก null เมื่อผู้ใช้ถูกลบ
if (pay.plan_tier !== "payg" && pay.user_id) {
  /* grant */
}
```

FK ของตารางการจ่ายเงินตั้งเป็น `ON DELETE SET NULL` ไม่ใช่ `CASCADE`
— ต่างจากตารางข้อมูลส่วนตัวที่เป็น `CASCADE`

## กฎที่ห้ามละเมิด

1. **export และ delete ต้องอยู่ที่เดียวกันในหน้า Settings** คนที่จะลบมักอยากได้สำเนาก่อน
2. **ไล่ตารางจาก types จริง** และตรวจชื่อคอลัมน์เจ้าของทีละตาราง
3. **export บอกสิ่งที่อ่านไม่ได้** (`skipped`) ไม่ใช่เงียบ
4. **ไฟล์เป็นลิงก์ ไม่ฝัง** และสร้างไฟล์ดาวน์โหลดใน browser
5. **ลบตามลำดับ**: แถวของคนอื่น → storage → audit → ลบ user เป็นขั้นสุดท้าย
6. **preview ด้วยตัวเลขจริง** และอ่านด้วยสิทธิ์ของผู้ใช้เอง
7. **ยืนยันด้วยการพิมพ์วลี และตรวจที่ server ด้วย**
8. **ตารางการเงินเก็บไว้ + null เจ้าของ** ไม่ใช่ cascade ทิ้ง
9. **sign out แบบ global หลังลบ**
10. **ทั้ง export และ delete ลง `privacy_audit_log`**

## บทเรียนจากของจริง

- **`is_shared = true` ค้างอยู่บนแถวของสมาชิกคนอื่น** หลังครอบครัวถูกยุบ
  cascade ตั้ง `family_id = NULL` แต่ไม่รู้เรื่อง flag แยก → แถวบอกว่า "แชร์อยู่"
  ทั้งที่ไม่มีวงให้แชร์ **บทเรียน: cascade ทำได้แค่ FK มันไม่รู้เรื่องสถานะเชิงความหมาย**
- **แถวการจ่ายเงินหายพร้อมบัญชี** ทำให้บัญชีรายรับไม่ตรง → เปลี่ยน FK เป็น SET NULL
- **คอลัมน์เจ้าของไม่ใช่ `user_id` เสมอ** `job_offers.helper_user_id`,
  `death_cases.subject_user_id` — ถ้าเดา export จะขาดและ delete จะทิ้งข้อมูลไว้

## ลอกไปใช้อย่างไร

1. migration ที่ตั้ง FK ให้ครบ: ข้อมูลส่วนตัว `ON DELETE CASCADE`,
   ตารางการเงิน/บัญชี `ON DELETE SET NULL`
2. ตาราง `privacy_audit_log(user_id, action, detail, meta, created_at)`
3. `exportMyData`: ไล่ `OWNED_TABLES` → นับแถว → ลิสต์ไฟล์เป็น signed url →
   manifest + skipped → คืนเป็นสตริง JSON → เขียน audit
4. `deletionPreview` ด้วย client ของผู้ใช้ + `deleteAccount` ตามลำดับ a→d
5. UI สองการ์ดติดกัน: ปุ่มดาวน์โหลด และไดอะล็อกที่ต้องพิมพ์วลี
6. ทดสอบ: สร้างผู้ใช้ทดสอบที่มีครอบครัว ไฟล์ และการจ่ายเงิน แล้วลบ
   → ตรวจว่าไฟล์หาย, แถวของสมาชิกคนอื่นไม่ค้าง `is_shared`,
   และแถวการจ่ายเงินยังอยู่โดย `user_id` เป็น null
