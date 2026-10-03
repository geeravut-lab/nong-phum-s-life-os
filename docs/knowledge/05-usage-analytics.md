# 05 · "การใช้งานของผู้ใช้" — DAU/WAU/MAU และเมนูที่ถูกใช้จริง

## ปัญหาที่แก้

ต้องตอบคำถามว่า "คนใช้เมนูไหน ใช้แค่ไหน และยังกลับมาไหม" โดย:

- ไม่ส่งข้อมูลออกไปให้ third-party analytics (ข้อมูลส่วนบุคคล + PDPA)
- ไม่ให้ client เขียนตัวเลขอะไรก็ได้
- ไม่เก็บสิ่งที่ไม่จำเป็น (ชื่อเรื่อง, query string, id)

## โครงที่ใช้

### ตารางเดียว: หนึ่งแถวต่อ ผู้ใช้ × วัน × path

```sql
-- supabase/migrations/20260927100000_usage_analytics.sql
-- usage_daily (user_id, day, path, views) UNIQUE (user_id, day, path)

CREATE OR REPLACE FUNCTION public.bump_usage(p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER            -- ← client เรียกได้ แต่เขียนค่าเองไม่ได้
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_daily (user_id, day, path, views)
  VALUES (auth.uid(), (now() AT TIME ZONE 'Asia/Bangkok')::date, p_path, 1)
  ON CONFLICT (user_id, day, path)
  DO UPDATE SET views = public.usage_daily.views + 1, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.bump_usage(text) FROM public;
GRANT EXECUTE ON FUNCTION public.bump_usage(text) TO authenticated;
```

**ทำไมต้องเป็น SECURITY DEFINER function ไม่ใช่ INSERT ตรง:** ถ้าให้ client
เขียนตารางเอง มันส่ง `views: 99999` ได้ ฟังก์ชันนี้รับแค่ path — `user_id`,
วันที่ และการ +1 เกิดในฐานข้อมูล

**วันที่คิดตามโซนเวลาไทย** ไม่ใช่ UTC — ไม่งั้น "วันนี้" ของผู้ใช้กับของรายงานต่างกัน 7 ชม.

### ฝั่ง client: นับหนึ่งครั้งต่อการเปลี่ยนหน้า และห้ามรบกวนผู้ใช้

```ts
// src/hooks/useTrackUsage.ts
export function useTrackUsage(): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuthUser();

  useEffect(() => {
    if (!user?.id) return;
    const path = normalizeUsagePath(pathname);
    // fire-and-forget โดยเจตนา: analytics ต้องไม่หน่วงหน้า และต้องไม่โชว์ error ให้ผู้ใช้
    void supabase.rpc("bump_usage", { p_path: path }).then(({ error }) => {
      if (error) console.warn("[usage] bump failed:", error.message);
    });
  }, [pathname, user?.id]);
}
```

เรียกที่เดียวใน `AppShell` → ทุกหน้าที่อยู่ใน shell ถูกนับโดยไม่ต้องไปแก้ทีละหน้า

### ยุบ path ที่มีพารามิเตอร์ ไม่งั้นรายงานเป็นขยะ

```ts
// src/lib/usage.ts
export function normalizeUsagePath(pathname: string): string {
  const parts = (pathname.split("?")[0] ?? "")
    .split("/")
    .filter(Boolean)
    .map((seg) =>
      // uuid, share token หรือเลขเปล่า = id ไม่ใช่เมนู
      /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^\d+$/.test(seg) || seg.length > 24 ? ":id" : seg,
    );
  return ("/" + parts.join("/")).slice(0, 80);
}
```

ไม่มีข้อนี้ `/legacy/invite/<token>` จะกลายเป็นหนึ่งแถวต่อหนึ่งลิงก์
และลิสต์ "เมนูยอดนิยม" จะเต็มไปด้วย noise

### ฝั่งรายงาน: รวมยอดใน SQL ไม่ใช่ใน browser

```sql
-- สามฟังก์ชัน SECURITY DEFINER, GRANT ให้ service_role เท่านั้น
usage_active_users(p_days integer)              -- COUNT(DISTINCT user_id)
usage_top_paths(p_days integer, p_limit integer) -- path, views, users
usage_daily_totals(p_days integer)              -- day, views, users
```

```ts
// src/lib/usage.functions.ts — requireAdmin คือด่านเดียวที่เข้าถึงได้
export const getUsageStats = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ data }) => {
    const [dau, wau, mau, top, daily] = await Promise.all([
      supabaseAdmin.rpc("usage_active_users", { p_days: 1 }),
      supabaseAdmin.rpc("usage_active_users", { p_days: 7 }),
      supabaseAdmin.rpc("usage_active_users", { p_days: 30 }),
      supabaseAdmin.rpc("usage_top_paths", { p_days: days, p_limit: 25 }),
      supabaseAdmin.rpc("usage_daily_totals", { p_days: days }),
    ]);
    for (const r of [dau, wau, mau, top, daily]) if (r.error) throw new Error(r.error.message);
    // …
  });
```

เหตุผล: ไม่กี่ร้อยผู้ใช้ก็เป็นหลายหมื่นแถวต่อเดือน — ดึงมารวมใน browser ไม่ไหว
และ RLS ให้ผู้ใช้เห็นแถวตัวเองเท่านั้น (`usage_daily_select_own`) ดังนั้น
การรวมทั้งระบบต้องผ่าน service_role

### ต้นทุน AI ต่อหน่วยงาน ใช้โครงเดียวกัน

`getAiCostStats` อ่าน `ai_events` + `ai_usage_monthly` แล้วประมาณค่าเงินด้วย
`estimateCostThb` (ตารางราคาต่อโมเดลใน `src/lib/ai-cost.ts`) — ทำให้ตอบได้ว่า
"แพ็ก ฿89 ขาดทุนหรือไม่" ซึ่งเป็นเหตุผลที่โครงการนี้เปลี่ยน default model
ของงาน reasoning จาก Opus เป็น Sonnet (ดูไฟล์ 11)

## กฎที่ห้ามละเมิด

1. **client ส่งได้แค่ path** ห้ามส่งตัวนับ, user id, ชื่อเรื่อง, query string
2. **ตัวนับอยู่ใน SECURITY DEFINER function** ไม่ใช่ INSERT/UPDATE ตรงจาก client
3. **ยุบ id ออกจาก path ก่อนเก็บ** เสมอ
4. **analytics ล้มเหลวต้องเงียบ** `console.warn` ได้ แต่ห้าม toast ห้าม throw
5. **การรวมยอดอยู่ใน SQL** และเปิดให้ admin เท่านั้น
6. **วันที่ใช้โซนเวลาของผู้ใช้จริง** (ที่นี่ = Asia/Bangkok)

## บทเรียนจากของจริง

- **ผู้ใช้ที่จ่ายเงินไม่ถูกนับ** โค้ดโควตาเดิม `return` ก่อนถึงตัวนับเมื่อเป็น premium
  → ไม่มีข้อมูลการใช้ของคนที่จ่ายเงินเลย ซึ่งคือกลุ่มเดียวที่ต้องใช้ตั้งราคา
  **บทเรียน: "ไม่จำกัด" ไม่ได้แปลว่า "ไม่นับ"**
- **path ที่มี token** ทำให้ top paths ใช้งานไม่ได้ จนกว่าจะยุบเป็น `:id`

## ลอกไปใช้อย่างไร

1. ตาราง `usage_daily(user_id, day, path, views)` + UNIQUE 3 คอลัมน์
2. ฟังก์ชัน `bump_usage(path)` แบบ SECURITY DEFINER + GRANT ให้ authenticated
3. hook เดียวใน shell ที่เรียก RPC ทุกครั้งที่ pathname เปลี่ยน
4. normalize path (uuid / เลข / ยาวเกิน 24 ตัว → `:id`)
5. ฟังก์ชันรวมยอดใน SQL + server fn ที่มี `requireAdmin`
6. หน้ารายงาน: DAU/WAU/MAU + top paths + กราฟรายวัน
   (ถ้าจะวาดกราฟ ให้ดูข้อแนะนำการวาดเองในไฟล์ 01 — ไม่ต้องลาก chart library มา)
