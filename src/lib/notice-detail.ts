// What a notification says, as opposed to where it is delivered.
//
// A notification used to carry a title and a one-line body, which was enough
// for a red dot in the app: the row is a pointer, and the user taps through to
// the page that holds the real information. A LINE card is not a pointer. It
// arrives on a phone that may never open the app that day, and "งานครอบครัวที่
// มอบหมายให้คุณ / ทดสอบ LINE" tells the reader neither who asked nor by when.
//
// So a body is built here as a summary line followed by "label: value" lines,
// and noticeCard turns those lines back into the label-value rows the Flex
// cards already use elsewhere. Keeping it in the text means no schema change
// and no second source of truth: the app inbox, the LINE card and the webhook
// payload all carry the same sentence.

import { APP_TIME_ZONE } from "./time";

const dateTimeTH = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateTH = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "ศ. 3 ต.ค. 2569 14:30 น." — Buddhist era, Bangkok, 24-hour. */
export function whenTH(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${dateTimeTH.format(d)} น.`;
}

/** Same but without a clock, for all-day things and plain dates. */
export function dayTH(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return dateTH.format(d);
}

/** "฿1,250" — amounts in a notification are always Thai baht. */
export function bahtTH(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return `฿${Math.round(n).toLocaleString("en-US")}`;
}

export const PRIORITY_TH: Record<string, string> = {
  high: "สำคัญมาก",
  normal: "ปกติ",
  low: "ไม่เร่ง",
};

export type NoticeDetail = [label: string, value: string | number | null | undefined];

/**
 * A summary line plus the details worth knowing, one per line.
 *
 * Empty values are dropped rather than rendered as "—": a card with four real
 * rows reads better than one with eight, half of them blank. Labels are kept
 * short because noticeCard gives them the narrow column.
 */
export function noticeBody(
  summary: string | null | undefined,
  details: NoticeDetail[] = [],
): string {
  const lines: string[] = [];
  const head = (summary ?? "").toString().trim();
  if (head) lines.push(head.replace(/\s*\n\s*/g, " ").slice(0, 300));
  for (const [label, value] of details) {
    const v = value === null || value === undefined ? "" : String(value).trim();
    if (!v) continue;
    // A newline inside a value would be read as another detail line.
    lines.push(`${label.trim()}: ${v.replace(/\s*\n\s*/g, " ").slice(0, 160)}`);
  }
  return lines.join("\n");
}

/**
 * Split a body back into its parts.
 *
 * A label may not contain a colon, which is what keeps "เวลา: 14:30" one row
 * rather than two, and a value may not start with "//" so that a bare URL in a
 * body is left as text instead of becoming a row labelled "https".
 */
export function parseNoticeBody(
  body: string | null | undefined,
): Array<{ label: string | null; value: string }> {
  return (body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^([^:]{1,24}):[ \t]*(.+)$/.exec(line);
      if (!m || m[2]!.startsWith("//")) return { label: null, value: line };
      return { label: m[1]!.trim(), value: m[2]!.trim() };
    });
}
