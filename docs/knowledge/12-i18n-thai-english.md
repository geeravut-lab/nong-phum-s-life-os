# 12 · สองภาษา (ไทย/อังกฤษ) และการสลับภาษา

## ปัญหาที่แก้

แอปที่ต้องใช้ได้ทั้งไทยและอังกฤษ โดย:

- ไม่มีข้อความตกหล่น (ภาษาหนึ่งมี key ที่อีกภาษาไม่มี) — และต้องรู้ตอน **compile**
- server code และ route `head()` อ่าน dictionary ได้ (เรียก hook ไม่ได้)
- error จาก server ต้องพูดภาษาของผู้ใช้
- SEO/link preview ต้องไม่พังเพราะ hydration

## โครงที่ใช้

### dictionary เป็น object ธรรมดา ไม่พึ่ง React

```ts
// src/lib/i18n.dict.ts
export type Lang = "th" | "en";

const th = {
  appName: "น้องภูมิ",
  navToday: "วันนี้",
  // … ~1,500 key
};

// ไทยเป็น source of truth: `satisfies` บน en ทำให้ key ที่ขาดหรือเกิน
// เป็น error ตอน compile ไม่ใช่ช่องว่างใน UI
export type Dict = {
  [K in keyof typeof th]: (typeof th)[K];
};

const en = {
  appName: "Nong Phum",
  navToday: "Today",
  // …
} satisfies Dict;

export const dict: Record<Lang, Dict> = { th, en };
```

**หัวใจอยู่ที่ `satisfies Dict`:** ถ้าลืมแปล key ไหน `tsc` ฟ้องทันที
ถ้าพิมพ์ key เกินมาใน `en` ก็ฟ้อง — ไม่มีทางที่ UI จะโชว์ key ดิบหรือค่าว่าง
ซึ่งเป็นวิธีที่ระบบสองภาษาพังกันโดยทั่วไป

### provider เบา ๆ + context

```tsx
// src/lib/i18n.provider.tsx
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("th"); // ไทยเป็น default ของ SSR

  useEffect(() => {
    const stored = window.localStorage.getItem("phum-lang");
    if (stored === "en" || stored === "th") setLangState(stored);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem("phum-lang", l);
    document.documentElement.lang = l; // ← สำคัญกับ screen reader และการตัดคำ
  }, []);

  const value = useMemo(() => ({ lang, setLang, t: dict[lang] }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
```

ใช้งาน: `const { t, lang, setLang } = useI18n();` แล้วเขียน `{t.navToday}`
ไม่มี `t("nav.today")` ที่สะกดผิดได้ — เป็น property access ที่ TypeScript ตรวจ

### อ่านภาษาจากนอก React

```ts
/**
 * ภาษาปัจจุบันนอก React: route head() และ server code เรียก useI18n() ไม่ได้
 * อ่าน localStorage key เดียวกับที่ provider เขียน; บน server (SSR ของ / และ /auth)
 * ไม่มี window จึงใช้ไทย — ค่า default ของแอป — และ client จะรัน head() ใหม่
 * ตอน navigate ครั้งถัดไป
 */
export function currentLang(): Lang {
  if (typeof window === "undefined") return "th";
  try {
    return window.localStorage.getItem("phum-lang") === "en" ? "en" : "th";
  } catch {
    return "th";
  }
}

/** ชื่อภาษาสำหรับ prompt ของ AI ("Reply in …") — ไม่ใช่ UI string, ที่เดียวแทนห้าที่ */
export function langName(lang: Lang): "English" | "Thai" {
  return lang === "en" ? "English" : "Thai";
}

/** เลือกข้อความตามภาษาจากคู่ { th, en } ที่เก็บในข้อมูล (เช่นตารางสิทธิ) */
export function localized(lang: Lang, pair: { th: string; en: string }): string {
  return lang === "en" ? pair.en : pair.th;
}
```

### `<head>`: title ตามภาษา แต่ description อยู่ที่ไทย — โดยเจตนา

```ts
export function routeMeta(page: …) {
  const title = dictFor(currentLang())[`meta_${page}_title`];
  const thTitle = dict.th[`meta_${page}_title`];
  const description = dict.th[`meta_${page}_desc`];
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: thTitle },
    // …
  ];
}
```

เหตุผล (เขียนไว้ในโค้ดเพราะดูเหมือนบั๊กถ้าไม่อ่าน):

> มีแต่ `<title>` ที่ตามภาษาผู้ใช้ `description` และ `og:*` อยู่ที่ไทยโดยเจตนา
> เพราะมันมีไว้ให้ crawler และ link preview ซึ่งเห็นแต่ HTML ที่ server render
> — ที่นั่นไม่มี localStorage และไทยคือ default
> ถ้าทำให้มันตามภาษาของ client จะเหลือ tag ไทยจาก SSR กับ tag อังกฤษจาก client
> อยู่ข้างกัน (React เก็บทั้งสองเมื่อ `<meta>` ที่ hoist แล้วต่างกัน)
> ขณะที่ `<title>` เป็น singleton ที่ browser แค่อัปเดตค่า

### error ของ server ต้องพูดภาษาผู้ใช้

server ไม่รู้ภาษา (อยู่ใน localStorage) จึงส่ง **รหัส** กลับมา:

```ts
// ฝั่ง server
throw appError("feature_off"); // → "app:feature_off"
return { allowed: false, message: "app:quota_payg_required" };
```

```ts
// ฝั่ง client: errorText(e, t) แปลงรหัสเป็นประโยคจาก dictionary
catch (e) { toast.error(errorText(e, t)); }
```

key เหล่านี้อยู่ใน dictionary ด้วย (`err_*`) จึงถูกบังคับให้แปลครบโดย `satisfies Dict` เช่นกัน

### ที่สลับภาษา: สองที่ และจำลง profile ด้วย

```tsx
// src/routes/index.tsx (หน้าก่อน login) — ปุ่มสลับเร็ว
<button onClick={() => setLang(lang === "th" ? "en" : "th")}>…</button>
```

```tsx
// src/routes/_authenticated/settings.tsx — จำลงฐานข้อมูลเมื่อ login แล้ว
const changeLang = async (next: Lang) => {
  setLang(next);
  await supabase.from("profiles").update({ language: next }).eq("id", profile!.id);
};
```

เก็บทั้ง localStorage (ใช้ทันที ไม่ต้องรอ network) และ `profiles.language`
(ติดตามไปเครื่องอื่น และให้ฝั่ง server รู้ภาษาเวลาจะส่งข้อความหาผู้ใช้)

### ข้อมูลในฐานข้อมูลที่มีสองภาษา

```ts
// ตารางเช่น benefits เก็บทั้งคู่: title / title_en
title: trim(lang === "en" ? r.title_en || r.title : r.title) || "—";
```

`r.title_en || r.title` — ถ้ายังไม่มีคำแปล แสดงไทยดีกว่าแสดงช่องว่าง

### ฟอร์แมตตัวเลข วันที่ สกุลเงิน

```ts
new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "th-TH-u-ca-buddhist", { … });
```

ไทยใช้ปฏิทินพุทธ (`-u-ca-buddhist`) — แปลคำแต่ไม่แปลปฏิทินคือครึ่งเดียว
และระวังว่าขอ `year` เดี่ยว ๆ ภาษาไทยจะเติม "พ.ศ." มาให้ (ดูไฟล์ 01)

## กฎที่ห้ามละเมิด

1. **ภาษาหนึ่งเป็น source of truth และอีกภาษา `satisfies` type ของมัน**
2. **dictionary ต้องไม่ import React** เพื่อให้ server และ `head()` อ่านได้
3. **เขียน `t.key` ไม่ใช่ `t("key")`** ให้ TypeScript จับคำสะกดผิด
4. **server ส่งรหัส client แปล** ห้าม hard-code ประโยคภาษาเดียวใน server
5. **`document.documentElement.lang` ต้องอัปเดตตอนสลับ**
6. **meta สำหรับ crawler ให้คงภาษาเดียว** (ภาษา SSR) เพื่อไม่ให้ hydration ทำ tag ซ้อน
7. **ปฏิทิน/ตัวเลข/สกุลเงิน ต้องเปลี่ยนตามภาษาด้วย** ไม่ใช่แค่คำ
8. **ข้อมูลสองภาษาในตาราง ให้ fallback ไปภาษาหลักเมื่อยังไม่มีคำแปล**

## บทเรียนจากของจริง

- **`satisfies Dict` จับคำแปลที่ลืมได้หลายสิบครั้งตลอดโครงการ** ทุกครั้งที่เพิ่ม
  ฟีเจอร์แล้วลืมเติม `en` — `tsc` ฟ้องก่อน commit ไม่มีครั้งไหนที่ผู้ใช้เห็น key ดิบ
- **meta description ที่ตามภาษา client ทำให้มี meta สองอันซ้อน** หลัง hydration
  → แก้โดยให้ description/og คงภาษาไทย (ภาษาของ SSR) ไว้
- **ข้อความ error ของ server เคยเป็นภาษาไทยติดอยู่ในโค้ด** ผู้ใช้อังกฤษจึงเจอ
  ไทยโผล่มา → เปลี่ยนเป็นรหัส `app:*` ทั้งหมดและแปลที่ client

## ลอกไปใช้อย่างไร

1. ไฟล์ dictionary ไฟล์เดียว: `const th = {…}`, `type Dict`, `const en = {…} satisfies Dict`
2. context + provider บาง ๆ ที่เก็บภาษาใน localStorage และตั้ง `documentElement.lang`
3. `currentLang()` สำหรับโค้ดนอก React + `dictFor(lang)`
4. `routeMeta()` ที่ title ตามภาษา แต่ meta สำหรับ crawler คงภาษา SSR
5. ฝั่ง server โยนรหัส `app:*` / `err_*`; ฝั่ง client มี `errorText(e, t)`
6. จำภาษาลง `profiles.language` เพื่อให้การแจ้งเตือนฝั่ง server ใช้ภาษาที่ถูก
7. ใช้ `Intl` ด้วย locale ที่ map จากภาษา รวมปฏิทินท้องถิ่น
