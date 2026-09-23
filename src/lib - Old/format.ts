import type { Lang } from "./i18n";
import { todayInBangkok } from "./time";

export function formatMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n || 0);
}

export function formatDay(d: Date, lang: Lang, withTime = false) {
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}

export function toDateInput(d: Date) {
  return todayInBangkok(d);
}
