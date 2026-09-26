export const PLACE_CATEGORIES = [
  "food",
  "cafe",
  "park",
  "market",
  "event",
  "workshop",
  "family",
  "health",
  "shop",
  "service",
  "other",
] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export type LocalPlace = {
  id: string;
  owner_user_id: string | null;
  name: string;
  name_en: string | null;
  category: PlaceCategory | string;
  description: string;
  area: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  tags: string[];
  price_level: number | null;
  open_hours: Record<string, string> | null;
  phone: string | null;
  website: string | null;
  is_active: boolean;
  is_promoted?: boolean;
  is_verified: boolean;
  community_note?: string | null;
  rating: number;
  review_count: number;
};

export type LocalDeal = {
  id: string;
  place_id: string;
  title: string;
  description: string;
  discount_label: string | null;
  budget_max: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};

export type LocalSearchIntent = {
  categories: PlaceCategory[];
  tags: string[];
  budgetMax: number | null;
  areaHint: string | null;
  withKids: boolean;
  openEvening: boolean;
  querySummary: string;
};

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function rankPlaces(
  places: LocalPlace[],
  intent: LocalSearchIntent,
  userLat: number | null,
  userLng: number | null,
): Array<LocalPlace & { distanceKm: number | null; score: number }> {
  return places
    .map((p) => {
      let score = 0;
      if (intent.categories.length && intent.categories.includes(p.category as PlaceCategory)) {
        score += 35;
      } else if (intent.categories.length) {
        score += 5;
      } else {
        score += 15;
      }
      const tagHits = (p.tags ?? []).filter((t) =>
        intent.tags.some((it) => t.toLowerCase().includes(it.toLowerCase())),
      ).length;
      score += Math.min(25, tagHits * 8);
      if (intent.withKids && (p.tags ?? []).some((t) => /kid|family|child|เด็ก/i.test(t))) {
        score += 15;
      }
      if (intent.budgetMax != null && p.price_level != null) {
        const approx = p.price_level * 150;
        if (approx <= intent.budgetMax) score += 15;
        else score -= 10;
      }
      let distanceKm: number | null = null;
      if (userLat != null && userLng != null && p.lat != null && p.lng != null) {
        distanceKm = haversineKm(userLat, userLng, p.lat, p.lng);
        if (distanceKm <= 3) score += 20;
        else if (distanceKm <= 8) score += 12;
        else if (distanceKm <= 15) score += 6;
        else score -= 5;
      }
      score += Math.min(10, Number(p.rating) * 2);
      if (intent.areaHint && p.area?.includes(intent.areaHint)) score += 10;
      return { ...p, distanceKm, score };
    })
    .sort((a, b) => b.score - a.score);
}
