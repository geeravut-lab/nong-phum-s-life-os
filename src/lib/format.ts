import type { Lang } from "./i18n";
import { APP_TIME_ZONE, todayInBangkok } from "./time";

export function formatMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n || 0);
}

/**
 * A date, and optionally a time, as the app reads them everywhere.
 *
 * The zone is pinned rather than left to the device: a phone set to another
 * country would otherwise shift every timestamp in the app by its own offset.
 * h23 is pinned for the same reason - the clock is 24-hour here whatever the
 * locale would have chosen.
 */
export function formatDay(d: Date, lang: Lang, withTime = false) {
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
  }).format(d);
}

export function toDateInput(d: Date) {
  return todayInBangkok(d);
}
