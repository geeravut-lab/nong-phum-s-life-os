# 02 · เมนู: Desktop sidebar + Smart Phone bottom bar

## ปัญหาที่แก้

แอปนี้มี 15 เมนูผู้ใช้ + เมนู admin ซึ่งเกินกว่าที่คนจะกวาดตาอ่านได้ในคอลัมน์เดียว
และโทรศัพท์มีที่ให้แค่ 4–5 ปุ่ม ปัญหาจริงที่ต้องแก้คือ:

- 15 รายการเรียงติดกันไม่มีหัวข้อ → ต้องอ่านทุก label เพื่อหาอันที่ต้องการ
- โทรศัพท์ใส่ได้ 5 ช่อง จะเอาเมนูไหนขึ้น และที่เหลือไปอยู่ไหน
- จุดแดง "มีอะไรใหม่" ต้องชี้ไปที่เมนูที่เกี่ยวข้อง และกดได้

## โครงที่ใช้

### หนึ่งลิสต์แบน เป็นต้นทางของทุกอย่าง

```tsx
// src/components/AppShell.tsx
const nav = [
  // ประจำวัน — 6
  { to: "/today", label: t.navToday, icon: Home },
  { to: "/chat", label: t.navChat, icon: MessageCircleHeart },
  { to: "/docs", label: t.navDocs, icon: FileText },
  { to: "/tasks", label: t.navTasks, icon: ListTodo },
  { to: "/agenda", label: t.navAgenda, icon: CalendarDays },
  { to: "/inbox", label: t.inboxTitle, icon: Bell },
  // ของฉัน — 3
  { to: "/search", ... }, { to: "/money", ... }, { to: "/family", ... },
  // บริการ — 4
  { to: "/helpme", ... }, { to: "/benefits", ... }, { to: "/decide", ... }, { to: "/local", ... },
  // ระยะยาว — 2
  { to: "/legacy", ... }, { to: "/support", ... },
] as const;

// กลุ่มคือ "รอยตัด" บนลิสต์เดียวกัน ไม่ใช่โครงสร้างแยก
const navGroups = [
  { label: t.navGroupDaily, items: nav.slice(0, 6) },
  { label: t.navGroupMine, items: nav.slice(6, 9) },
  { label: t.navGroupServices, items: nav.slice(9, 13) },
  { label: t.navGroupLong, items: nav.slice(13) },
];

// โทรศัพท์: 4 อันแรกขึ้น bottom bar, ที่เหลือเข้า sheet "เพิ่มเติม"
const primaryNav = nav.slice(0, 4);
const moreGroups = navGroups
  .map((g) => ({ label: g.label, items: g.items.filter((i) => !primaryNav.includes(i)) }))
  .filter((g) => g.items.length > 0);
```

**ทำไมลิสต์แบนเป็นต้นทาง:** bottom bar คือ 4 อันแรกของลิสต์ และกลุ่มคือรอยตัดบน
ลิสต์เดียวกัน เพิ่มเมนูใหม่ที่ตำแหน่งเดียว แล้วทั้งสามที่ (sidebar, bar, sheet)
ได้ของตรงกันอัตโนมัติ — ไม่มีทางที่สองที่จะลืมอัปเดต

**ลำดับมีความหมาย:** 4 อันแรกคือสิ่งที่แตะทุกวัน เพราะมันคือ bottom bar
"การแจ้งเตือน" อยู่อันดับ 6 (ต้นสุดของ sheet) เพราะครึ่งหนึ่งของเมนูอื่นยิงจุดแดงมาที่มัน

### สามพื้นที่ จาก source เดียว

| พื้นที่           | แสดงเมื่อ   | เนื้อหา                                         |
| ----------------- | ----------- | ----------------------------------------------- |
| sidebar           | `md:flex`   | ทุกเมนู แบ่ง 4 กลุ่ม + admin/คู่มือ/ตั้งค่าท้าย |
| mobile header     | `md:hidden` | โลโก้ + plan badge + จุดแดงรวม (กดไป `/inbox`)  |
| bottom bar        | `md:hidden` | 4 เมนูแรก + ปุ่ม "เพิ่มเติม"                    |
| sheet "เพิ่มเติม" | เปิดจาก bar | เมนูที่เหลือ (กลุ่มเดิม) + ท้ายเหมือน sidebar   |

### จุดแดง: map จาก notification → เมนู

จุดแดงทั้งระบบขับด้วยแถว unread ใน `app_notifications` เพียงอย่างเดียว
หัวใจคือฟังก์ชันแปลง "notification → path ของเมนู":

```ts
// src/hooks/useInboxBadges.ts
function kindToNav(kind: string, href: string | null): string {
  if (href?.startsWith("/helpme") || href?.startsWith("/helper-dashboard")) return "/helpme";
  if (href?.startsWith("/local")) return "/local";
  if (href?.startsWith("/admin")) return "/admin";
  // หน้าที่อยู่ "ใน" section แต่ไม่ใช่เมนูของตัวเอง ต้องพับเข้าเมนูแม่
  // ไม่ทำข้อนี้ = แจ้งเตือนมาถึงแต่จุดแดงไม่มีที่ลง = ผู้ใช้ไม่รู้เลย
  if (href?.startsWith("/legacy")) return "/legacy";
  if (kind.startsWith("job_") || kind === "payment" || kind === "safety") return "/helpme";
  return href?.split("?")[0] || "/today";
}
```

แล้วซ่อนจุดของหน้าที่ผู้ใช้กำลังดูอยู่ และ mark read ให้เมื่อเข้าถึง:

```ts
const activeNavBase = useMemo(() => {
  if (pathname.startsWith("/helpme") || pathname.startsWith("/helper-dashboard")) return "/helpme";
  if (pathname.startsWith("/admin")) return "/admin";
  return pathname;
}, [pathname]);

const visibleUnreadByNav = useMemo(() => {
  const map = new Map(unreadByNav);
  if (activeNavBase) map.delete(activeNavBase); // อยู่หน้านั้นแล้ว ไม่ต้องมีจุด
  return map;
}, [unreadByNav, activeNavBase]);
```

`kindToNav` และ `activeNavBase` ต้องพับ path ชุดเดียวกัน ไม่งั้นจุดแดงของหน้าที่
ผู้ใช้เปิดอยู่จะไม่หาย

### จุดแดงต้องกดได้ และต้องเป็นลิงก์ของตัวเอง

```tsx
// ❌ เดิม: จุดอยู่ "ข้างใน" ลิงก์โลโก้ที่ชี้ /today
<Link to="/today"><PhumMark /><span className="...bg-red-500" /></Link>

// ✅ แยกเป็นลิงก์ของตัวเอง ชี้ไปหน้าแจ้งเตือน
<Link to="/today"><PhumMark />{appName}</Link>
{visibleTotal > 0 && (
  <Link to="/inbox" aria-label={t.inboxTitle} className="ml-auto flex size-8 items-center justify-center">
    <span className="size-2 animate-pulse rounded-full bg-red-500" />
  </Link>
)}
```

พื้นที่แตะ `size-8` (32px) ครอบจุดขนาด 8px — จุดเล็กเกินกว่าจะเป็นเป้านิ้วเอง

## กฎที่ห้ามละเมิด

1. **ลิสต์เมนูมีที่เดียว** ทุกพื้นที่ derive จากมัน
2. **จุดแดงต้องเป็นลิงก์** ของตัวเอง ไม่อยู่ซ้อนในลิงก์อื่น และต้องมีพื้นที่แตะ ≥ 32px
3. **ทุก href ของการแจ้งเตือนต้องพับได้เป็นเมนูที่มีจริง** เพิ่มหน้าใหม่ใน section
   → ต้องเพิ่มบรรทัดพับใน `kindToNav` พร้อมกัน
4. **`kindToNav` และ `activeNavBase` พับเหมือนกัน** มิฉะนั้นจุดไม่หายเมื่ออ่านแล้ว
5. **ปุ่ม "เพิ่มเติม" ต้องมีจุดแดงรวมของทุกอย่างที่ซ่อนอยู่ข้างใน**
   (`moreHasBadge = nav.slice(4).some(hasBadge) || hasBadge("/admin")`)

## บทเรียนจากของจริง

- **จุดแดงบน sidebar พาไปหน้า "วันนี้"** เพราะมันอยู่ข้างในลิงก์โลโก้
  บนมือถือทำถูก (เป็นลิงก์แยก) แต่เดสก์ท็อปลืม → ผู้ใช้กดจุดแล้วไปผิดหน้าทุกครั้ง
- **แจ้งเตือนผลตรวจแผนงานศพมาถึงแบบเงียบ ๆ** เพราะ href เป็น `/legacy/after`
  ซึ่ง `kindToNav` ไม่พับเป็น `/legacy` → จุดแดงไม่มีเมนูให้ลง
  ตรวจทั้งระบบพบว่า `/helper-dashboard` ก็อยู่ในสถานะเดียวกัน รอดมาได้เพราะ
  `kind` ของมันขึ้นต้นด้วย `job_` พอดี
- **หัวข้อกลุ่มทำให้ sidebar ยาวขึ้นจนรายการสุดท้ายหลุดจอ** แก้ด้วยการลดความสูงแถว
  (`py-2`) + `ScrollHint` บอกว่ายังเลื่อนได้ (ดูไฟล์ 01)

## ลอกไปใช้อย่างไร

1. เขียนลิสต์เมนูแบนเรียงตาม "ใช้บ่อยสุดก่อน" แล้วตัดเป็นกลุ่มด้วย `slice`
2. ให้ bottom bar = `slice(0, 4)` + ปุ่มเพิ่มเติม; sheet = ส่วนที่เหลือ
3. เขียน `kindToNav` ตั้งแต่ต้น และถือเป็นกฎว่า **ทุกครั้งที่เพิ่ม href
   ของ notification ต้องเช็กว่ามันพับลงเมนูได้**
4. ทดสอบจุดแดงด้วยการ insert แถวแจ้งเตือนจริงแล้วดูว่าจุดขึ้นที่ไหน:

```js
// เขียนแถวแจ้งเตือนของตัวเอง (RLS อนุญาต user_id = auth.uid())
// แล้วเช็กว่าจุดขึ้นที่เมนูที่ควรขึ้น
await fetch(`${base}app_notifications`, {
  method: "POST",
  headers: { apikey, Authorization, "Content-Type": "application/json" },
  body: JSON.stringify({ user_id, kind: "funeral_review", title: "…", href: "/legacy/after" }),
});
// → aside a[href="/legacy"] span.bg-red-500 ต้องมีอยู่
```
