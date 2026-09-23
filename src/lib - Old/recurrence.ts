// Recurring reminders advance "in place": the same row moves to its next
// occurrence instead of spawning a new one. The arithmetic happens on the
// Bangkok wall clock so a 09:00 reminder stays a 09:00 reminder; Bangkok has
// no daylight saving, so a fixed +07:00 round-trip is exact.
//
// Used by both the scheduled tick (server) and the "done" button (client), so
// the two can never disagree about what "next month" means. No imports beyond
// time.ts: this file ships in the client bundle.
import { APP_TIME_ZONE, APP_UTC_OFFSET } from "./time";

export type Recurrence = "none" | "monthly" | "yearly";

export function isRepeating(recurrence: string | null | undefined): recurrence is "monthly" | "yearly" {
  return recurrence === "monthly" || recurrence === "yearly";
}

type WallClock = { y: number; m: number; d: number; hh: number; mm: number; ss: number };

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function toWallClock(date: Date): WallClock {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.formatToParts(date).find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute"), ss: get("second") };
}

function fromWallClock(w: WallClock): Date {
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return new Date(`${p(w.y, 4)}-${p(w.m)}-${p(w.d)}T${p(w.hh)}:${p(w.mm)}:${p(w.ss)}${APP_UTC_OFFSET}`);
}

function daysInMonth(y: number, m: number): number {
  // Day 0 of the next month is the last day of this one (UTC arithmetic on a
  // calendar-only value; no zone involved).
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * `dueAt` plus `count` periods. The day of month is clamped to what the
 * target month has, so 31 Jan + 1 month is 28 Feb (29 in a leap year) and
 * 29 Feb + 1 year is 28 Feb. Because the count is applied to the ORIGINAL
 * date, 31 Jan + 2 months is 31 Mar, not 28 Mar — the anchor day survives
 * within one call. Across separate advances it does not: once a reminder has
 * landed on the 28th it stays on the 28th. (Keeping the original anchor would
 * need a column; noted in docs/PHASE-1-PLAN.md §1.3.)
 */
export function addPeriods(dueAt: Date, recurrence: "monthly" | "yearly", count: number): Date {
  const w = toWallClock(dueAt);
  let y = w.y;
  let m = w.m;
  if (recurrence === "monthly") {
    const total = m - 1 + count;
    y += Math.floor(total / 12);
    m = (total % 12) + 1;
  } else {
    y += count;
  }
  return fromWallClock({ ...w, y, m, d: Math.min(w.d, daysInMonth(y, m)) });
}

/**
 * The first occurrence strictly after `after`. A reminder that sat unfinished
 * for three months moves to next month, not to a date still in the past — one
 * catch-up notification, not three.
 */
export function nextOccurrence(dueAt: Date, recurrence: "monthly" | "yearly", after: Date): Date {
  for (let k = 1; k < 1200; k++) {
    const next = addPeriods(dueAt, recurrence, k);
    if (next.getTime() > after.getTime()) return next;
  }
  throw new Error("nextOccurrence: no occurrence within 100 years");
}

/**
 * The latest occurrence of the series that is <= `now`, or `dueAt` itself
 * when none has passed yet. Used when a missed recurring reminder is rolled
 * forward: it lands on the occurrence that just came due, not on a future one.
 */
export function lastOccurrenceAtOrBefore(dueAt: Date, recurrence: "monthly" | "yearly", now: Date): Date {
  let last = dueAt;
  for (let k = 1; k < 1200; k++) {
    const cand = addPeriods(dueAt, recurrence, k);
    if (cand.getTime() > now.getTime()) return last;
    last = cand;
  }
  return last;
}
