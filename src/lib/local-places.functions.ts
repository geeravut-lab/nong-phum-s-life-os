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
  category: string;
  mapsUrl: string | null;
  source: "google";
};

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
    const key = mapsKey();
    if (!key) {
      return {
        places: [] as GooglePlaceItem[],
        error: "missing_api_key" as const,
        message: "ยังไม่ได้ตั้ง GOOGLE_MAPS_API_KEY ใน Netlify — แสดงเฉพาะสถานที่จากผู้ใช้ในระบบ",
      };
    }

    const radiusM = Math.round((data.radiusKm ?? 5) * 1000);
    const lang = data.lang === "en" ? "en" : "th";
    const items: GooglePlaceItem[] = [];

    try {
      if (data.lat != null && data.lng != null) {
        // Places API (New) nearby search
        const body: Record<string, unknown> = {
          maxResultCount: 20,
          languageCode: lang,
          locationRestriction: {
            circle: {
              center: { latitude: data.lat, longitude: data.lng },
              radius: radiusM,
            },
          },
        };
        if (data.query?.trim()) {
          // Text search with location bias
          const textBody = {
            textQuery: data.query.trim(),
            maxResultCount: 20,
            languageCode: lang,
            locationBias: {
              circle: {
                center: { latitude: data.lat, longitude: data.lng },
                radius: radiusM,
              },
            },
          };
          const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": key,
              "X-Goog-FieldMask":
                "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.googleMapsUri",
            },
            body: JSON.stringify(textBody),
          });
          const json = (await res.json()) as {
            places?: Array<{
              id?: string;
              displayName?: { text?: string };
              formattedAddress?: string;
              location?: { latitude?: number; longitude?: number };
              rating?: number;
              types?: string[];
              googleMapsUri?: string;
            }>;
            error?: { message?: string };
          };
          if (!res.ok) {
            return {
              places: [] as GooglePlaceItem[],
              error: "api_error" as const,
              message: json.error?.message ?? res.statusText,
            };
          }
          for (const p of json.places ?? []) {
            items.push({
              id: p.id ?? crypto.randomUUID(),
              googlePlaceId: p.id ?? "",
              name: p.displayName?.text ?? "—",
              address: p.formattedAddress ?? null,
              lat: p.location?.latitude ?? null,
              lng: p.location?.longitude ?? null,
              rating: p.rating ?? null,
              category: (p.types?.[0] ?? "place").replace(/_/g, " "),
              mapsUrl: p.googleMapsUri ?? null,
              source: "google",
            });
          }
        } else {
          const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": key,
              "X-Goog-FieldMask":
                "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.googleMapsUri",
            },
            body: JSON.stringify({
              ...body,
              includedTypes: [
                "restaurant",
                "cafe",
                "park",
                "shopping_mall",
                "store",
                "tourist_attraction",
              ],
            }),
          });
          const json = (await res.json()) as {
            places?: Array<{
              id?: string;
              displayName?: { text?: string };
              formattedAddress?: string;
              location?: { latitude?: number; longitude?: number };
              rating?: number;
              types?: string[];
              googleMapsUri?: string;
            }>;
            error?: { message?: string };
          };
          if (!res.ok) {
            return {
              places: [] as GooglePlaceItem[],
              error: "api_error" as const,
              message: json.error?.message ?? res.statusText,
            };
          }
          for (const p of json.places ?? []) {
            items.push({
              id: p.id ?? crypto.randomUUID(),
              googlePlaceId: p.id ?? "",
              name: p.displayName?.text ?? "—",
              address: p.formattedAddress ?? null,
              lat: p.location?.latitude ?? null,
              lng: p.location?.longitude ?? null,
              rating: p.rating ?? null,
              category: (p.types?.[0] ?? "place").replace(/_/g, " "),
              mapsUrl: p.googleMapsUri ?? null,
              source: "google",
            });
          }
        }
      } else if (data.query?.trim()) {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.googleMapsUri",
          },
          body: JSON.stringify({
            textQuery: data.query.trim(),
            maxResultCount: 20,
            languageCode: lang,
          }),
        });
        const json = (await res.json()) as {
          places?: Array<{
            id?: string;
            displayName?: { text?: string };
            formattedAddress?: string;
            location?: { latitude?: number; longitude?: number };
            rating?: number;
            types?: string[];
            googleMapsUri?: string;
          }>;
          error?: { message?: string };
        };
        if (!res.ok) {
          return {
            places: [] as GooglePlaceItem[],
            error: "api_error" as const,
            message: json.error?.message ?? res.statusText,
          };
        }
        for (const p of json.places ?? []) {
          items.push({
            id: p.id ?? crypto.randomUUID(),
            googlePlaceId: p.id ?? "",
            name: p.displayName?.text ?? "—",
            address: p.formattedAddress ?? null,
            lat: p.location?.latitude ?? null,
            lng: p.location?.longitude ?? null,
            rating: p.rating ?? null,
            category: (p.types?.[0] ?? "place").replace(/_/g, " "),
            mapsUrl: p.googleMapsUri ?? null,
            source: "google",
          });
        }
      }
    } catch (e) {
      return {
        places: [] as GooglePlaceItem[],
        error: "network" as const,
        message: e instanceof Error ? e.message : String(e),
      };
    }

    return { places: items, error: null as null, message: null as null };
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
