// Every "what day is it" decision in the app goes through here.
//
// The browser runs in the user's zone (Bangkok) but Netlify Functions run in
// UTC, and Date#toISOString() is always UTC regardless of where it runs. So
// between 00:00 and 07:00 Bangkok time, "today" computed the naive way is
// yesterday. Pin the zone explicitly instead of trusting the environment.

export const APP_TIME_ZONE = "Asia/Bangkok";
export const APP_UTC_OFFSET = "+07:00";

// en-CA formats as YYYY-MM-DD, which is exactly the shape Postgres `date`
// columns and <input type="date"> want.
const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date in Bangkok as YYYY-MM-DD. `now` is injectable for tests. */
export function todayInBangkok(now: Date = new Date()): string {
  return ymd.format(now);
}

/** First day of the current Bangkok month as YYYY-MM-DD. */
export function monthStartInBangkok(now: Date = new Date()): string {
  return `${todayInBangkok(now).slice(0, 7)}-01`;
}

/**
 * A calendar date plus a Bangkok wall-clock hour, as an ISO instant for
 * timestamptz columns. new Date("2026-09-30") alone would be UTC midnight,
 * which is 07:00 in Bangkok and shows up as a meaningless "07:00" reminder.
 */
export function bangkokDateAtHour(ymdDate: string, hour: number): string {
  const hh = String(hour).padStart(2, "0");
  return new Date(`${ymdDate}T${hh}:00:00${APP_UTC_OFFSET}`).toISOString();
}

// Wall-clock time in Bangkok as HH:mm, 24-hour. Same reason as todayInBangkok:
// a Netlify Function runs in UTC, so "now" read naively is seven hours early.
const hm = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Current Bangkok wall-clock time as HH:mm. `now` is injectable for tests. */
export function nowTimeInBangkok(now: Date = new Date()): string {
  return hm.format(now);
}

/**
 * A Bangkok date and wall-clock time as an ISO instant for a timestamptz
 * column. Either part may be missing: a day with no time takes the current
 * time of day, and no day at all takes today - which is what someone means by
 * "I spent 80 on lunch" with no date, and by "I spent it yesterday" with no
 * clock. Stamping midnight instead would claim a precision nobody gave.
 */
export function bangkokDateTime(
  ymdDate: string | null | undefined,
  hhmm: string | null | undefined,
  now: Date = new Date(),
): string {
  const day = ymdDate?.trim() || todayInBangkok(now);
  const time = /^\d{1,2}:\d{2}$/.test(hhmm?.trim() ?? "")
    ? (hhmm as string).trim().padStart(5, "0")
    : nowTimeInBangkok(now);
  return new Date(`${day}T${time}:00${APP_UTC_OFFSET}`).toISOString();
}

/**
 * A datetime the model produced, read as Bangkok wall-clock whatever zone it
 * tagged on.
 *
 * The prompt asks for +07:00 and the model mostly obliges, but not always:
 * moving a 09:00 reminder to another day came back as ...T09:00:00Z, and
 * new Date() then stored 02:00 Bangkok - the right clock face, seven hours
 * wrong. Every time in this app is Bangkok time, and a person who says nine
 * in the morning means nine in the morning, so the wall-clock is what is kept
 * and the zone is re-applied. An explicit numeric offset is trusted, because
 * that is the model doing as it was asked.
 */
export function bangkokIsoFromLoose(value: string): string {
  const v = value.trim();
  if (/[+-]\d{2}:?\d{2}$/.test(v)) return new Date(v).toISOString();
  const naive = v.endsWith("Z") ? v.slice(0, -1) : v;
  const parsed = new Date(`${naive}${APP_UTC_OFFSET}`);
  // Anything unparseable falls back to the original rather than becoming
  // Invalid Date and losing the reminder entirely.
  return Number.isNaN(parsed.getTime()) ? new Date(v).toISOString() : parsed.toISOString();
}

/**
 * First and last day of a Bangkok calendar month, as YYYY-MM-DD.
 *
 * `offset` counts months back from the current one: 0 is this month, -1 last
 * month. Built from the Bangkok date string rather than Date arithmetic so it
 * cannot drift by a day when the server runs in UTC, and so that the 31st of
 * a month rolls to the right place (new Date(2026, 0, 31) with setMonth(-1)
 * lands in December but keeps the 31st; here the day is never carried).
 */
export function bangkokMonthRange(
  offset = 0,
  now: Date = new Date(),
): { from: string; to: string } {
  const [y, m] = todayInBangkok(now).split("-").map(Number) as [number, number];
  // Months as a single count so the year rolls over on its own.
  const total = y * 12 + (m - 1) + offset;
  const year = Math.floor(total / 12);
  const month = total % 12; // 0-11
  const mm = String(month + 1).padStart(2, "0");
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

// The hour of the day an instant falls on, in Bangkok. Date#getHours() is the
// server's own zone, which on Netlify is UTC - so a 14:00 Bangkok appointment
// read as 07:00 and was compared against the wrong end of a working day.
const hourOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

/** 0-23 in Bangkok, or null when the input is not a usable instant. */
export function bangkokHourOf(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const n = Number(hourOnly.format(d));
  return Number.isFinite(n) ? n : null;
}
