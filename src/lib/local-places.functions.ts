import { featureEnabled } from "@/lib/flags.server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function mapsKey(): string | undefined {
  return (
    process.env["GOOGLE_MAPS_API_KEY"] ||
    process.env["GOOGLE_PLACES_API_KEY"] ||
    process.env["VITE_GOOGLE_MAPS_API_KEY"] ||
    undefined
  );
}

export type GooglePlaceItem = {
  id: string;
  googlePlaceId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  /** How many reviews the rating is based on - a 5.0 from two people is not a 5.0. */
  ratingCount: number | null;
  category: string;
  /** Google's own types, cleaned up, shown as tags like a merchant's tags. */
  tags: string[];
  openNow: boolean | null;
  /** Today's hours in words, as Google phrases them ("Monday: 9 AM - 6 PM"). */
  hoursToday: string | null;
  mapsUrl: string | null;
  source: "google";
  /** Distance from the user, when we know where they are. Null otherwise. */
  distanceKm?: number | null;
};

/**
 * What we ask Google for, in one place.
 *
 * Every field here is in the Enterprise SKU because of `rating`, so adding
 * userRatingCount and regularOpeningHours alongside it does not move the call
 * into a dearer tier - it is the same request, answered more fully. Keep new
 * fields out of the mask unless the page actually renders them.
 */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.regularOpeningHours",
  "places.googleMapsUri",
].join(",");

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  googleMapsUri?: string;
};

/** weekdayDescriptions starts on Monday; JS getDay() starts on Sunday. */
function todaysHours(descriptions: string[] | undefined): string | null {
  if (!descriptions || descriptions.length < 7) return null;
  // The app serves Thailand, and the server clock is UTC, so ask for the
  // Bangkok weekday rather than the container's.
  const bkk = new Date(Date.now() + 7 * 3600_000);
  return descriptions[(bkk.getUTCDay() + 6) % 7] ?? null;
}

function toItem(p: RawPlace): GooglePlaceItem {
  const types = (p.types ?? []).map((x) => x.replace(/_/g, " "));
  return {
    id: p.id ?? crypto.randomUUID(),
    googlePlaceId: p.id ?? "",
    name: p.displayName?.text ?? "—",
    address: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    category: types[0] ?? "place",
    // The first type is already shown as the category, and Google repeats
    // itself ("restaurant", "food", "point of interest", "establishment").
    tags: types.slice(1).filter((x) => x !== "point of interest" && x !== "establishment"),
    openNow: p.regularOpeningHours?.openNow ?? null,
    hoursToday: todaysHours(p.regularOpeningHours?.weekdayDescriptions),
    mapsUrl: p.googleMapsUri ?? null,
    source: "google",
  };
}

/** Great-circle distance in km, or null when either end has no coordinates. */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number | null,
  lng2: number | null,
): number | null {
  if (lat2 == null || lng2 == null) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nearby / text search via Google Places API (New). Requires GOOGLE_MAPS_API_KEY. */
export const searchGooglePlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        query: z.string().max(200).optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        radiusKm: z.number().min(0.5).max(50).optional(),
        lang: z.enum(["th", "en"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // The client checks this too, but the client is not what Google bills.
    if (!(await featureEnabled("google_places"))) {
      return { places: [] as GooglePlaceItem[], error: null as null, message: null as null };
    }
    const key = mapsKey();
    if (!key) {
      return {
        places: [] as GooglePlaceItem[],
        error: "missing_api_key" as const,
        message: "app:google_key_missing",
      };
    }

    const radiusM = Math.round((data.radiusKm ?? 5) * 1000);
    const lang = data.lang === "en" ? "en" : "th";
    const q = data.query?.trim();
    const hasCoords = data.lat != null && data.lng != null;
    const circle = hasCoords
      ? { center: { latitude: data.lat!, longitude: data.lng! }, radius: radiusM }
      : null;

    // Three cases, one request: a query searches text (biased to the user when
    // we know where they are), and coordinates alone search nearby.
    let endpoint: string;
    let body: Record<string, unknown>;
    if (q) {
      endpoint = "places:searchText";
      body = {
        textQuery: q,
        maxResultCount: 20,
        languageCode: lang,
        ...(circle ? { locationBias: { circle } } : {}),
      };
    } else if (circle) {
      endpoint = "places:searchNearby";
      body = {
        maxResultCount: 20,
        languageCode: lang,
        locationRestriction: { circle },
        includedTypes: [
          "restaurant",
          "cafe",
          "park",
          "shopping_mall",
          "store",
          "tourist_attraction",
        ],
      };
    } else {
      // Nothing to search on: no query and no location.
      return { places: [] as GooglePlaceItem[], error: null as null, message: null as null };
    }

    try {
      const res = await fetch(`https://places.googleapis.com/v1/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { places?: RawPlace[]; error?: { message?: string } };
      if (!res.ok) {
        return {
          places: [] as GooglePlaceItem[],
          error: "api_error" as const,
          message: json.error?.message ?? res.statusText,
        };
      }
      /**
       * The radius has to hold for a text search too.
       *
       * searchNearby takes locationRestriction, which Google enforces. For a
       * query the only thing it accepts is locationBias - a preference it is
       * free to ignore - so searching "ห้าง" from the suburbs came back with
       * malls at Siam, 10 km outside the radius the user had set. The circle
       * is therefore applied here as well, on the coordinates Google returns
       * with each place.
       */
      const items = (json.places ?? []).map(toItem).map((it) => ({
        ...it,
        distanceKm: hasCoords ? haversineKm(data.lat!, data.lng!, it.lat, it.lng) : null,
      }));
      const within = hasCoords
        ? // A place with no coordinates cannot be measured; keeping it is
          // better than silently dropping a result that may well be near.
          items.filter((it) => it.distanceKm == null || it.distanceKm <= (data.radiusKm ?? 5))
        : items;

      return {
        places: within,
        error: null as null,
        message: null as null,
      };
    } catch (e) {
      return {
        places: [] as GooglePlaceItem[],
        error: "network" as const,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

/** List only non-demo active user/merchant places from DB */
export const listUserLocalPlaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const supabaseAdmin = await admin();
    const { data, error } = await supabaseAdmin
      .from("local_places")
      .select("*")
      .eq("is_active", true)
      .order("is_promoted", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { places: data ?? [] };
  });
