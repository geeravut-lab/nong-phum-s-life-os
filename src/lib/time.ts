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
