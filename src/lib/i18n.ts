import { createContext, useContext } from "react";

import { dict, type Dict, type Lang } from "./i18n.dict";

export type { Dict, Lang } from "./i18n.dict";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: Dict };

export const I18nContext = createContext<Ctx>({ lang: "th", setLang: () => {}, t: dict.th });

export function useI18n() {
  return useContext(I18nContext);
}

export const categoryLabels: Record<string, { th: string; en: string }> = {
  bill: { th: "บิล/ค่าสาธารณูปโภค", en: "Bills & utilities" },
  insurance: { th: "ประกัน", en: "Insurance" },
  vehicle: { th: "รถ", en: "Vehicle" },
  home: { th: "บ้าน", en: "Home" },
  health: { th: "สุขภาพ", en: "Health" },
  education: { th: "การเรียน", en: "Education" },
  finance: { th: "การเงิน", en: "Finance" },
  government: { th: "ราชการ", en: "Government" },
  food: { th: "อาหาร", en: "Food" },
  transport: { th: "เดินทาง", en: "Transport" },
  shopping: { th: "ช้อปปิ้ง", en: "Shopping" },
  family: { th: "ครอบครัว", en: "Family" },
  other: { th: "อื่น ๆ", en: "Other" },
};

export function catLabel(key: string | null | undefined, lang: Lang) {
  const k = key ?? "other";
  return categoryLabels[k]?.[lang] ?? k;
}
