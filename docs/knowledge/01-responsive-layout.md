# 01 · Fully-responsive layout

## ปัญหาที่แก้

"Responsive" ที่ทำกันคือย่อจอแล้วไม่พัง แต่ปัญหาจริงบนมือถือที่เจอในโครงการนี้
ไม่มีอันไหนโผล่ตอนลากขอบ browser เลย:

- ช่อง `<input type="date">` กว้างตามข้อความข้างใน ช่อง "ตั้งแต่/ถึง" จึงกว้างไม่เท่ากัน
- ป้ายเดือน "ก.ย. 69" ขึ้นบรรทัดเองเฉพาะบางเดือน แถวป้ายสูงไม่เท่ากัน ดันกราฟเบี้ยว
- `100vh` บน iOS นับรวมแถบที่เลื่อนหาย กล่องพิมพ์แชทจึงอยู่ใต้ขอบจอ
- bottom bar ทับเนื้อหาบรรทัดสุดท้ายของทุกหน้า
- sidebar ที่ยาวขึ้นเพราะเพิ่มเมนู ทำให้รายการสุดท้ายหลุดจอโดยไม่มีอะไรบอกว่าเลื่อนได้

## โครงที่ใช้

### หนึ่ง breakpoint เท่านั้น: `md` (768px)

ทั้งแอปตัดสินใจที่จุดเดียว — เล็กกว่า 768px = โทรศัพท์, ตั้งแต่ 768px = เดสก์ท็อป
ไม่มี `sm:` / `lg:` / `xl:` สำหรับโครงหลัก (ใช้เฉพาะปรับจำนวนคอลัมน์ในกริดย่อย)

เหตุผล: breakpoint ทุกอันที่เพิ่มคือสถานะที่ต้องทดสอบจริงอีกหนึ่งอัน
โครงการนี้มีโครงหลักสองแบบ จึงใช้จุดตัดจุดเดียว

```tsx
// src/components/AppShell.tsx — โครงเดียว ใช้ทั้งสองแบบ
<div className="min-h-screen bg-background md:flex">
  <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col ... md:flex">
    {/* sidebar: เดสก์ท็อปเท่านั้น */}
  </aside>

  <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
    <header className="sticky top-0 z-30 ... md:hidden">{/* header: มือถือเท่านั้น */}</header>
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 md:px-6 md:py-8">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-40 flex ... md:hidden">{/* bottom bar */}</nav>
  </div>
</div>
```

จุดที่ต้องสังเกตในสี่บรรทัดนั้น:

| class                       | ทำไมต้องมี                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| `h-dvh` (ไม่ใช่ `h-screen`) | `100vh` บน iOS นับแถบที่ซ่อนได้ด้วย → sidebar สูงเกินจอ                     |
| `pb-20 md:pb-0`             | bottom bar เป็น `fixed` จึงไม่กินที่ ต้องเผื่อ padding ให้เนื้อหาเอง        |
| `min-w-0 flex-1`            | flex child ไม่ยอมแคบกว่าเนื้อหา — ไม่มีอันนี้ ตารางยาว ๆ ดันจอกว้างทั้งหน้า |
| `max-w-3xl mx-auto`         | เดสก์ท็อปจอกว้าง 2560px ไม่ได้อยากอ่านบรรทัดยาว 2560px                      |
| `px-4 md:px-6`              | gutter 16px บนมือถือ เป็นค่าต่ำสุดที่นิ้วไม่ชนขอบ                           |

### ช่องกรอกที่ต้องกว้างเท่ากัน ต้องสั่งความกว้าง ไม่ใช่หวังว่าเท่า

ช่อง native (`date`, `time`, `number`) กว้างตามเนื้อหา ไม่ใช่ตาม container
ถ้าอยากให้แถวกรองดูเป็นระเบียบบนมือถือ ต้องกำหนด basis เอง:

```tsx
// ทุกช่องกว้างครึ่งแถวเท่ากันบนมือถือ, เรียงแถวเดียวบนจอใหญ่
<div className="flex flex-wrap gap-2">
  <div className="min-w-0 basis-[calc(50%-0.25rem)] space-y-1 sm:basis-40">
    <Label htmlFor="tf-from">กำหนดตั้งแต่</Label>
    <DateInput id="tf-from" className="w-full" />
  </div>
  {/* อีกสามช่องใช้ class เดียวกัน */}
</div>
```

`calc(50%-0.25rem)` = ครึ่งหนึ่ง ลบครึ่งของ `gap-2` (0.5rem) — สองช่องพอดีหนึ่งแถว
`min-w-0` จำเป็น เพราะ flex item มี `min-width: auto` โดยปริยาย

### ป้ายกราฟ: บังคับจำนวนบรรทัด ไม่ปล่อยให้ตัดเอง

```tsx
// src/components/MoneyTrend.tsx
// เดือนบรรทัดบน ปีบรรทัดล่าง "เสมอ" ทุกคอลัมน์จึงสูงเท่ากัน
<span className="text-center text-[10px] leading-tight text-muted-foreground">
  <span className="block whitespace-nowrap">{monthOf(m.key)}</span>
  <span className="block whitespace-nowrap">{yearOf(m.key)}</span>
</span>
```

แถวของแท่งกราฟใช้ `items-stretch` ไม่ใช่ `items-end` — ถ้าใช้ `items-end`
คอลัมน์ที่ป้ายสูงกว่าจะดันแท่งของตัวเองขึ้น เส้นฐานจึงไม่ตรงกัน

### บอกว่ายังเลื่อนได้ (`ScrollHint`)

รายการที่ยาวเกินกรอบไม่มีอะไรบอกผู้ใช้เลย โครงการนี้วัดเองแล้วแสดงลูกศรจาง ๆ:

```tsx
const measure = () => {
  const el = ref.current;
  if (!el) return;
  // เผื่อไม่กี่ px: ความสูงเศษทศนิยมจะทำให้ลูกศรล่างค้างอยู่ทั้งที่เลื่อนสุดแล้ว
  setMore({
    up: el.scrollTop > 4,
    down: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
  });
};
// ResizeObserver ด้วย ไม่ใช่แค่ onScroll — รายการโตขึ้นได้โดยไม่มีใครเลื่อน
// (เมนู admin โผล่มา, label ตัดบรรทัดที่ความกว้างอื่น)
```

### safe area ของเครื่องที่มีขอบมน / home indicator

```tsx
className = "pb-[max(0.75rem,env(safe-area-inset-bottom))]";
```

ใช้ `max()` ไม่ใช่ `env()` เดี่ยว ๆ — เครื่องที่ไม่มี inset จะได้ 0 แล้วปุ่มชนขอบ

## กฎที่ห้ามละเมิด

1. **อย่าใช้ `100vh`/`h-screen` กับอะไรที่ต้องพอดีจอบนมือถือ** ใช้ `dvh`
2. **อะไรที่ `fixed` แล้วทับเนื้อหา ต้องมี padding ชดเชยที่ container**
3. **ช่อง native ที่ต้องเรียงสวย ต้องกำหนด `basis`/`w-full` เอง**
4. **ทุก flex child ที่อาจมีเนื้อหายาว ต้องมี `min-w-0`** ไม่งั้นหน้าเลื่อนซ้ายขวาได้
5. **ทดสอบที่ 390×844 จริง ไม่ใช่ลากขอบ browser** — ปัญหาข้างบนครึ่งหนึ่ง
   ไม่โผล่เลยถ้าไม่ตั้ง viewport + deviceScaleFactor ให้เหมือนเครื่องจริง

## บทเรียนจากของจริง

- **กล่องพิมพ์แชทบังข้อความล่าสุด** โค้ดเดิมเลื่อนไปที่ "ตัวคั่นล่างสุด" (sentinel)
  ซึ่งทิ้งทุกอย่างที่อยู่ถัดจากมันในหน้าไว้ใต้ขอบจอ — รวมกล่องพิมพ์
  แก้ด้วยการเลื่อนไป `document.documentElement.scrollHeight` ซึ่งเป็นตำแหน่งเดียวที่ถูกเสมอ
- **ป้าย "พ.ศ. 69"** ขอ `year: "2-digit"` จาก `Intl` เดี่ยว ๆ ภาษาไทยจะเติมศักราชให้
  ใต้ชื่อเดือนสามตัวอักษรมันคือสิ่งที่กว้างที่สุดในคอลัมน์ ต้อง `.replace(/[^\d]/gu, "")`
- **scroll restoration ของ router** คืนตำแหน่ง _หลัง_ effect ของหน้าทำงาน
  และเรียก `scrollTo({top: 0})` เมื่อไม่มีตำแหน่งเก็บไว้ → หน้าแชทต้อง opt-out:
  `scrollRestoration: ({ location }) => location.pathname !== "/chat"`

## ลอกไปใช้อย่างไร

1. ตั้ง breakpoint เดียว เลือกให้ตรงกับ "โครงสองแบบ" ที่แอปมีจริง
2. เขียน AppShell เดียวที่มีทั้งสองโครง ซ่อนด้วย `md:hidden` / `hidden md:flex`
3. ใส่ `dvh`, `min-w-0`, `pb-*` ชดเชย fixed, `max-w-*` และ gutter ตั้งแต่วันแรก
4. เขียนสคริปต์ทดสอบที่ตั้ง viewport มือถือจริง และ **วัดค่า** (ความกว้างช่อง,
   ตำแหน่งเส้นฐานของแท่งกราฟ) ไม่ใช่ดูภาพเอา — ตัวเลขจับ regression ได้ ภาพจับไม่ได้

```js
// ตัวอย่างการวัดที่ใช้จริง (Playwright)
const w = await p.evaluate(() => {
  const a = document.querySelector("#tf-from")?.getBoundingClientRect();
  const b = document.querySelector("#tf-to")?.getBoundingClientRect();
  return a && b ? { from: Math.round(a.width), to: Math.round(b.width) } : null;
});
// → {"from":175,"to":175} equal: true
```
