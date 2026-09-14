// Flex Message cards for LINE (phase 1.3 step 4b). Layout follows the
// WelCares card the owner supplied: a coloured header with the title, a body
// of label–value rows, and a real button to open the app. Pure functions with
// no imports beyond time.ts so the tick bundle and tests can use them.
//
// Rules baked in (from docs/PHASE-1-PLAN.md §1.3):
//   * altText carries the actual content — it is what the notification bar
//     and clients that cannot render Flex show
//   * every free-text node has wrap: true; Thai has no spaces to break on
//   * dates are Buddhist era, Bangkok time
//   * immediate = one card, one reminder · digest = one card, many rows
import { APP_TIME_ZONE } from "./time";

// oklch(0.52 0.098 205) — the app's --primary — as hex for LINE.
const BRAND = "#0E7490";
const BRAND_SOFT = "#CFFAFE";
const INK = "#111827";
const MUTED = "#6B7280";
const DANGER = "#DC2626";

export type FlexReminder = {
  id: string;
  title: string;
  due_at: string | null;
  priority: string;
  recurrence: string;
  notes?: string | null;
};

export type FlexMessage = { type: "flex"; altText: string; contents: Record<string, unknown> };

const dateTime = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const longDate = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const timeOnly = new Intl.DateTimeFormat("th-TH", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function thaiDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

const PRIORITY_TH: Record<string, string> = { high: "สำคัญมาก", normal: "ปกติ", low: "ไม่เร่ง" };
const RECURRENCE_TH: Record<string, string> = { monthly: "ทุกเดือน", yearly: "ทุกปี" };

function text(t: string, extra: Record<string, unknown> = {}) {
  // LINE rejects an empty text node; never emit one.
  return { type: "text", text: t.trim() || "—", wrap: true, ...extra };
}

function row(label: string, value: string, valueExtra: Record<string, unknown> = {}) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      text(label, { size: "sm", color: MUTED, flex: 2 }),
      text(value, { size: "sm", color: INK, flex: 5, ...valueExtra }),
    ],
  };
}

function header(kicker: string, title: string, sub?: string) {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: BRAND,
    paddingAll: "16px",
    spacing: "xs",
    contents: [
      text(kicker, { size: "xs", color: BRAND_SOFT }),
      text(title, { size: "lg", weight: "bold", color: "#FFFFFF" }),
      ...(sub ? [text(sub, { size: "sm", color: BRAND_SOFT })] : []),
    ],
  };
}

function footer(appUrl: string, label: string) {
  return {
    type: "box",
    layout: "vertical",
    paddingAll: "12px",
    contents: [
      {
        type: "button",
        style: "primary",
        color: BRAND,
        height: "sm",
        action: { type: "uri", label, uri: appUrl },
      },
    ],
  };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** One card for one reminder that just came due. */
export function immediateCard(r: FlexReminder, appUrl: string): FlexMessage {
  const when = r.due_at ? thaiDateTime(r.due_at) : "—";
  const rows: unknown[] = [row("กำหนด", when), row("ความสำคัญ", PRIORITY_TH[r.priority] ?? r.priority, r.priority === "high" ? { color: DANGER, weight: "bold" } : {})];
  if (RECURRENCE_TH[r.recurrence]) rows.push(row("ทำซ้ำ", RECURRENCE_TH[r.recurrence]!));
  if (r.notes?.trim()) rows.push(row("หมายเหตุ", clip(r.notes.trim(), 200)));
  return {
    type: "flex",
    altText: clip(`ถึงกำหนดแล้ว: ${r.title} — ${when}`, 400),
    contents: {
      type: "bubble",
      size: "mega",
      header: header("น้องภูมิเตือน", r.title),
      body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "16px", contents: rows },
      footer: footer(appUrl, "เปิดน้องภูมิ"),
    },
  };
}

const DIGEST_MAX_ROWS = 8;

/** One card listing everything that came due on `dayIso` (a Bangkok day, any instant in it). */
export function digestCard(items: FlexReminder[], dayIso: string, appUrl: string): FlexMessage {
  const day = longDate.format(new Date(dayIso));
  const shown = items.slice(0, DIGEST_MAX_ROWS);
  const rows: unknown[] = [];
  shown.forEach((r, i) => {
    if (i > 0) rows.push({ type: "separator" });
    const meta = [
      r.due_at ? `กำหนด ${timeOnly.format(new Date(r.due_at))} น.` : null,
      r.priority === "high" ? PRIORITY_TH["high"] : null,
      RECURRENCE_TH[r.recurrence] ?? null,
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push({
      type: "box",
      layout: "vertical",
      spacing: "xs",
      contents: [
        text(`${i + 1}. ${r.title}`, { size: "sm", weight: "bold", color: INK }),
        ...(meta ? [text(meta, { size: "xs", color: r.priority === "high" ? DANGER : MUTED })] : []),
      ],
    });
  });
  if (items.length > shown.length) {
    rows.push({ type: "separator" });
    rows.push(text(`และอีก ${items.length - shown.length} เรื่อง ดูทั้งหมดในแอป`, { size: "xs", color: MUTED }));
  }
  const titles = items.map((r) => r.title).join(", ");
  return {
    type: "flex",
    altText: clip(`วันนี้มี ${items.length} เรื่องถึงกำหนด: ${titles}`, 400),
    contents: {
      type: "bubble",
      size: "mega",
      header: header("สรุปประจำวันจากน้องภูมิ", day, `${items.length} เรื่องถึงกำหนด`),
      body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "16px", contents: rows },
      footer: footer(appUrl, "เปิดน้องภูมิ"),
    },
  };
}
