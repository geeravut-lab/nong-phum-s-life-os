/**
 * Multi-stop itinerary ("Route & Itinerary: จัดเส้นทางหลายจุด").
 *
 * Pure functions, no network: ordering is done locally and the result is handed
 * to Google Maps as a directions url with waypoints. That keeps the feature
 * free of a Directions API key, which the project does not have, and the
 * ordering is still far better than the arbitrary order things were picked in.
 */

export type Stop = {
  id: string;
  title: string;
  lat: number | null;
  lng: number | null;
  /** Fixed clock time, when the stop is an event rather than a place. */
  startsAt?: string | null;
  address?: string | null;
};

const R = 6371; // km

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Order stops into a route.
 *
 * Timed stops come first, in clock order: an event at 18:00 cannot be moved to
 * suit the driving, so the route is built around them. Untimed stops are then
 * appended nearest-first (a greedy nearest-neighbour walk from the start
 * point, or from the last timed stop). Greedy is not optimal, but for the
 * handful of stops a person picks for an evening it is the right trade against
 * an exact solver or a paid Directions API.
 */
export function orderStops(stops: Stop[], from: { lat: number; lng: number } | null): Stop[] {
  const timed = stops
    .filter((s) => !!s.startsAt)
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
  const untimed = stops.filter((s) => !s.startsAt);

  const ordered: Stop[] = [...timed];

  // Walk from wherever the timed part leaves us, else from the user.
  let cursor: { lat: number; lng: number } | null =
    timed.length > 0 && timed[timed.length - 1]?.lat != null && timed[timed.length - 1]?.lng != null
      ? { lat: timed[timed.length - 1]!.lat!, lng: timed[timed.length - 1]!.lng! }
      : from;

  const pool = [...untimed];
  while (pool.length > 0) {
    let pick = 0;
    if (cursor) {
      let best = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i]!;
        if (s.lat == null || s.lng == null) continue;
        const d = haversineKm(cursor, { lat: s.lat, lng: s.lng });
        if (d < best) {
          best = d;
          pick = i;
        }
      }
    }
    const next = pool.splice(pick, 1)[0]!;
    ordered.push(next);
    if (next.lat != null && next.lng != null) cursor = { lat: next.lat, lng: next.lng };
  }

  return ordered;
}

/** Total straight-line distance of a route, for a rough "how far is this" hint. */
export function routeDistanceKm(
  ordered: Stop[],
  from: { lat: number; lng: number } | null,
): number | null {
  const pts = ordered
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ lat: s.lat!, lng: s.lng! }));
  if (pts.length === 0) return null;
  const all = from ? [from, ...pts] : pts;
  if (all.length < 2) return null;
  let total = 0;
  for (let i = 1; i < all.length; i++) total += haversineKm(all[i - 1]!, all[i]!);
  return Math.round(total * 10) / 10;
}

/**
 * Google Maps directions url for the whole route.
 *
 * Uses coordinates where known and falls back to the address text, so a stop
 * without a pin still routes. Google caps waypoints on a shared link, so the
 * middle is trimmed rather than producing a url Maps refuses to open.
 */
export function mapsRouteUrl(ordered: Stop[], from: { lat: number; lng: number } | null): string {
  const MAX_WAYPOINTS = 9;
  // Coordinates route exactly; an address is a decent lookup. A title is the
  // last resort and often useless to Maps ("แข่งกิน" is an event name, not a
  // place), so it is only used when there is nothing else.
  const key = (s: Stop) =>
    s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : s.address?.trim() || s.title;

  const points = ordered.map(key).filter(Boolean);
  if (points.length === 0) return "https://www.google.com/maps";

  // The last stop is always the destination. Only when the user's location is
  // unknown AND there is more than one stop does the first stop become the
  // origin instead. Taking the origin first used to leave a single-stop plan
  // with an origin and no destination, which opened Maps on a blank route.
  const destination = points.pop()!;
  const origin = from ? `${from.lat},${from.lng}` : points.length > 0 ? points.shift() : undefined;

  const params = new URLSearchParams({ api: "1" });
  if (origin) params.set("origin", origin);
  params.set("destination", destination);
  if (points.length > 0) {
    params.set("waypoints", points.slice(0, MAX_WAYPOINTS).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
