/**
 * open_hours JSON, two accepted shapes:
 *
 *   legacy, same window every day:  { open: "09:00", close: "18:00" }
 *   per day:  { mon: { open: "09:00", close: "18:00" }, tue: null, ... }
 *
 * A day present with null (or missing entirely, when any per-day key exists)
 * means closed that day. The legacy shape is still read so places saved before
 * per-day hours keep working.
 */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export type DayHours = { open: string; close: string } | null;
export type OpenHours = Partial<Record<DayKey, DayHours>> & {
  open?: string;
  close?: string;
};

function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function isOpenNow(
  openHours: Record<string, unknown> | null | undefined,
  now = new Date(),
): boolean | null {
  if (!openHours || typeof openHours !== "object") return null;

  // Per-day wins when the object carries any day key, so a place that is shut
  // on Monday reads as closed rather than falling back to a general window.
  const hasPerDay = DAY_KEYS.some((d) => d in openHours);
  let open: string | undefined;
  let close: string | undefined;

  if (hasPerDay) {
    const today = openHours[DAY_KEYS[now.getDay()] as string];
    if (!today || typeof today !== "object") return false; // closed today
    const t = today as { open?: string; close?: string };
    open = t.open;
    close = t.close;
  } else {
    open = (openHours["open"] ?? openHours["start"]) as string | undefined;
    close = (openHours["close"] ?? openHours["end"]) as string | undefined;
  }
  if (!open || !close) return null;
  const o = parseHm(open);
  const c = parseHm(close);
  if (o == null || c == null) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (c > o) {
    // same-day window e.g. 09:00–18:00
    return mins >= o && mins < c;
  }
  // overnight e.g. 16:00–02:00
  return mins >= o || mins < c;
}

export function mapsUrl(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  // Coordinates only. This used to pass query twice - once as the pin and once
  // as the name - and Google keeps just one of them, so a link meant for a shop
  // could open a text search for its name somewhere else entirely. The name is
  // already on the card; what the link has to get right is the place.
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function directionsUrl(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}`;
}
