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
  /**
   * The physical place this stop happens at. An event's own title names what
   * happens, not where - "แข่งกิน" is not somewhere Maps can find - so the
   * venue is what gets routed to when there are no coordinates.
   */
  venue?: string | null;
  /**
   * Google place id, when the stop came from Google Places. Passed alongside
   * the name so Maps resolves the exact shop rather than searching the text.
   */
  placeId?: string | null;
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

  if (ordered.length === 0) return "https://www.google.com/maps";

  // The last stop is always the destination. Only when the user's location is
  // unknown AND there is more than one stop does the first stop become the
  // origin instead. Taking the origin first used to leave a single-stop plan
  // with an origin and no destination, which opened Maps on a blank route.
  const rest = [...ordered];
  const last = rest.pop()!;
  const dest = pointFor(last);

  // Every stop is named the same way, not just the destination. Naming only
  // the last one is what made a plan wrong as soon as the shop was not last:
  // a middle stop fell back to its address, and for a place whose address is
  // only "นนทบุรี" that is where Maps sent the driver. Coordinates are no
  // better in the middle - Maps labels a bare pin with whatever business it
  // finds nearest, which is how วัดสวนแก้ว came out as a shop across the road.
  const waypoints = rest.map(pointFor);
  const origin: { text: string; placeId?: string } | undefined = from
    ? { text: `${from.lat},${from.lng}` }
    : waypoints.length > 0
      ? waypoints.shift()
      : undefined;
  const kept = waypoints.slice(0, MAX_WAYPOINTS);

  const params = new URLSearchParams({ api: "1" });
  if (origin) params.set("origin", origin.text);
  if (origin?.placeId) params.set("origin_place_id", origin.placeId);
  params.set("destination", dest.text);
  if (dest.placeId) params.set("destination_place_id", dest.placeId);
  if (kept.length > 0) {
    params.set("waypoints", kept.map((p) => p.text).join("|"));
    // Google matches waypoint_place_ids to waypoints by position, so the list
    // is only sent when every waypoint has an id - a partial list would shift
    // ids onto the wrong stops, which is worse than sending none.
    if (kept.every((p) => p.placeId)) {
      params.set("waypoint_place_ids", kept.map((p) => p.placeId!).join("|"));
    }
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * How a stop is named to Maps.
 *
 * Coordinates route exactly but open an unlabelled pin, and the user wants to
 * see which shop they are heading to - so the venue name is used whenever it
 * can be made unambiguous: with the Google place id when we have one, else
 * with the address appended so the search cannot drift to another branch of
 * the same chain. A name on its own is not enough to route by, so without
 * either of those the coordinates win over the label.
 */
function pointFor(s: Stop): { text: string; placeId?: string } {
  const name = s.venue?.trim() || null;
  const address = s.address?.trim() || null;
  const placeId = s.placeId?.trim() || null;
  const hasPin = s.lat != null && s.lng != null;

  // The name wins whenever there is one. Coordinates route to an exact point
  // but open an unnamed pin, and the person driving wants to see the shop they
  // are going to - which is the thing that has been asked for repeatedly.
  //
  // Precision is recovered where it can be: a Google place id resolves the name
  // to exactly one shop, and an address narrows a name that a chain would
  // otherwise share across branches. A bare name is the weakest of the three
  // and can still land on the wrong branch, which is the cost of showing it.
  if (name && placeId) return { text: name, placeId };
  if (name && address) return { text: `${name}, ${address}` };
  if (name) return { text: name };
  if (hasPin) return { text: `${s.lat},${s.lng}` };
  return { text: address || s.title };
}
