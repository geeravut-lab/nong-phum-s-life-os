/** open_hours JSON shape: { open: "09:00", close: "18:00" } or per-day keys */

function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function isOpenNow(
  openHours: Record<string, string> | null | undefined,
  now = new Date(),
): boolean | null {
  if (!openHours || typeof openHours !== "object") return null;
  const open = openHours.open ?? openHours.start;
  const close = openHours.close ?? openHours.end;
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

export function mapsUrl(lat: number | null, lng: number | null, name?: string): string | null {
  if (lat == null || lng == null) return null;
  const q = name ? encodeURIComponent(name) : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=&query=${q}`;
}

export function directionsUrl(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}`;
}
