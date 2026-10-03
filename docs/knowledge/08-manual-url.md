# 08 · "ลิงก์คู่มือการใช้งาน" ที่ admin ตั้งได้

## ปัญหาที่แก้

คู่มือผู้ใช้เป็นไฟล์ PDF ที่เจ้าของโปรเจกต์เก็บไว้ที่ไหนก็ได้ (Drive, S3, เว็บตัวเอง)
และเปลี่ยนที่อยู่ได้ตลอด ถ้า bundle ลิงก์ไว้ในโค้ด ทุกครั้งที่ย้ายไฟล์ต้อง deploy

และเมนูที่กดแล้วไม่มีอะไรเกิดขึ้น แย่กว่าไม่มีเมนูนั้น

## โครงที่ใช้

### เก็บใน `platform_settings.manual_url` และยอมรับแค่ https

```ts
// src/lib/admin.functions.ts
export const setManualUrl = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        url: z
          .string()
          .trim()
          .max(1000)
          .refine((v) => v === "" || /^https:\/\//i.test(v), "https_only"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("platform_settings")
      .update({ manual_url: data.url })
      .eq("id", true);
    if (error) throw error;
    return { ok: true as const, url: data.url };
  });
```

เหตุผลที่บังคับ https:

- `http` จะถูกบล็อกเป็น mixed content อยู่แล้ว
- `javascript:` หรือ `data:` ในเมนูที่ผู้ใช้ทุกคนกด ไม่ใช่เรื่องที่ควรปล่อยให้เสี่ยง
- สตริงว่าง = ล้างค่า ซึ่งทำให้เมนูหายไป (ไม่ใช่เมนูที่กดแล้วเงียบ)

### อ่านรวมกับ feature flags เพื่อไม่ให้มีสอง request

```ts
// src/hooks/useFeatureFlags.ts
type PlatformSettings = { flags: FlagMap; manualUrl: string };

export function usePlatformSettings() {
  return useQuery<PlatformSettings>({
    queryKey: ["feature-flags"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // manual_url มาพร้อม migration และเว็บ deploy ก่อนที่ใครจะรัน
      // PostgREST ปฏิเสธ select ทั้งก้อนถ้ามีคอลัมน์ที่ไม่รู้จักหนึ่งคอลัมน์
      // ขอทั้งคู่ก่อน ถ้าพลาดให้ถอยไปขอคอลัมน์ที่มีมาตลอด
      const both = await supabase
        .from("platform_settings")
        .select("feature_flags, manual_url")
        .maybeSingle();
      if (!both.error) {
        return {
          flags: (both.data?.feature_flags ?? {}) as FlagMap,
          manualUrl: ((both.data?.manual_url ?? "") as string).trim(),
        };
      }
      const { data } = await supabase
        .from("platform_settings")
        .select("feature_flags")
        .maybeSingle();
      return { flags: (data?.feature_flags ?? {}) as FlagMap, manualUrl: "" };
    },
  });
}

/** ลิงก์คู่มือที่ admin ตั้งไว้ หรือ "" เมื่อยังไม่ได้ตั้ง */
export function useManualUrl(): string {
  return usePlatformSettings().data?.manualUrl ?? "";
}
```

**บทเรียนที่ฝังอยู่ในฟังก์ชันนี้:** PostgREST ปฏิเสธ `select` ทั้งชุดถ้าคอลัมน์หนึ่ง
ไม่มีอยู่ ถ้าไม่มี fallback นี้ ช่วงระหว่าง deploy กับ `db push` **feature flags
ทั้งหมดจะอ่านว่า "เปิด"** เพราะ query พัง — คือสวิตช์ทั้งแผงใช้ไม่ได้
เพราะเพิ่มคอลัมน์ที่ไม่เกี่ยวกันหนึ่งคอลัมน์

### ซ่อนเมนูเมื่อไม่มีค่า และเปิดแท็บใหม่

```tsx
// src/components/AppShell.tsx — ทั้ง sidebar และ sheet ใช้เงื่อนไขเดียวกัน
{
  manualUrl ? (
    <a href={manualUrl} target="_blank" rel="noreferrer" className={linkClass}>
      <BookOpen className="size-4 shrink-0" />
      <span className="truncate">{t.navManual}</span>
    </a>
  ) : null;
}
```

เป็น `<a>` ไม่ใช่ router `<Link>` เพราะเป็นลิงก์ภายนอก
`rel="noreferrer"` มาคู่กับ `target="_blank"` เสมอ

## กฎที่ห้ามละเมิด

1. **ค่าว่าง = ซ่อนเมนู** ห้ามมีเมนูที่กดแล้วไปหน้าเปล่า
2. **https เท่านั้น** และตรวจที่ server ไม่ใช่แค่ใน form
3. **`target="_blank"` ต้องมี `rel="noreferrer"`**
4. **select ที่มีคอลัมน์ใหม่ ต้องมี fallback** สำหรับช่วงก่อน migration
5. **อ่านตั้งค่ารวมใน query เดียว** ถ้าหลายค่าถูกใช้ในหน้าเดียวกัน

## ลอกไปใช้อย่างไร

1. คอลัมน์ `manual_url text` (หรือ `*_url` อื่น ๆ) ใน `platform_settings`
2. server fn ตั้งค่าแบบ `requireAdmin` + validate https + รับค่าว่างเพื่อล้าง
3. hook ที่อ่านตั้งค่าทั้งก้อนใน query เดียว พร้อม fallback คอลัมน์ขาด
4. ใน UI: `{url ? <a …/> : null}` ในทุกที่ที่เมนูนั้นปรากฏ (ที่นี่มีสองที่: sidebar + sheet)
