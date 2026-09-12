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
