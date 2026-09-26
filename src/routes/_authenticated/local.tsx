import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchGooglePlaces } from "@/lib/local-places.functions";
import { useMemo, useState } from "react";
import {
  ExternalLink,
  MapPin,
  Navigation,
  Search,
  Star,
  Store,
  Tag,
  Loader2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import { parseLocalQuery } from "@/lib/local.functions";
import {
  rankPlaces,
  type LocalDeal,
  type LocalPlace,
  type LocalSearchIntent,
} from "@/lib/local.shared";
import { directionsUrl, isOpenNow, mapsUrl } from "@/lib/local-hours";

export const Route = createFileRoute("/_authenticated/local")({
  head: () => ({ meta: routeMeta("local") }),
  component: LocalPage,
});

function LocalPage() {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const runParse = useServerFn(parseLocalQuery);
  const runGoogle = useServerFn(searchGooglePlaces);
  const [googlePlaces, setGooglePlaces] = useState<
    Array<{
      id: string;
      name: string;
      address: string | null;
      lat: number | null;
      lng: number | null;
      rating: number | null;
      category: string;
      mapsUrl: string | null;
    }>
  >([]);
  const [googleMsg, setGoogleMsg] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<LocalSearchIntent | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [openOnly, setOpenOnly] = useState(false);
  const [reviewPlaceId, setReviewPlaceId] = useState<string | null>(null);
  const [reviewStars, setReviewStars] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

  const placesQ = useQuery({
    queryKey: ["local-places"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("local_places")
        .select("*")
        .eq("is_active", true)
                // is_public: show shared places (default true)
        .order("is_promoted", { ascending: false })
        .order("rating", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as (LocalPlace & {
        is_promoted?: boolean;
        community_note?: string | null;
      })[];
    },
  });

  const dealsQ = useQuery({
    queryKey: ["local-deals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("local_deals")
        .select("*")
        .eq("is_active", true)
                .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as LocalDeal[];
    },
  });

  const ranked = useMemo(() => {
    const places = (placesQ.data ?? []).filter((p) => (p as { is_demo?: boolean }).is_demo !== true);
    let list = places;
    if (openOnly) {
      list = list.filter((p) => isOpenNow(p.open_hours as Record<string, string>) === true);
    }
    const withinRadius = <T extends { distanceKm?: number | null }>(rows: T[]) => {
      if (!coords) return rows;
      return rows.filter((p) => p.distanceKm == null || p.distanceKm <= radiusKm);
    };
    if (!intent) {
      return withinRadius(
        list
          .map((p) => {
            let distanceKm: number | null = null;
            if (coords && p.lat != null && p.lng != null) {
              const R = 6371;
              const dLat = ((p.lat - coords.lat) * Math.PI) / 180;
              const dLng = ((p.lng - coords.lng) * Math.PI) / 180;
              const s =
                Math.sin(dLat / 2) ** 2 +
                Math.cos((coords.lat * Math.PI) / 180) *
                  Math.cos((p.lat * Math.PI) / 180) *
                  Math.sin(dLng / 2) ** 2;
              distanceKm = 2 * R * Math.asin(Math.sqrt(s));
            }
            const promoBoost = p.is_promoted ? 50 : 0;
            return {
              ...p,
              distanceKm,
              score: promoBoost + Number(p.rating) * 10 - (distanceKm ?? 0),
            };
          })
          .sort((a, b) => b.score - a.score),
      );
    }
    return withinRadius(
      rankPlaces(list, intent, coords?.lat ?? null, coords?.lng ?? null).map((p) => ({
        ...p,
        score: p.score + (p.is_promoted ? 40 : 0),
      })),
    );
  }, [placesQ.data, intent, coords, openOnly, radiusKm]);

  const dealsByPlace = useMemo(() => {
    const m = new Map<string, LocalDeal[]>();
    for (const d of dealsQ.data ?? []) {
      const list = m.get(d.place_id) ?? [];
      list.push(d);
      m.set(d.place_id, list);
    }
    return m;
  }, [dealsQ.data]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error(t.localNoGeo);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void (async () => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        toast.success(t.localGeoOk);
        try {
          const res = (await runGoogle({
            data: { lat, lng, radiusKm, lang: lang === "en" ? "en" : "th" },
          })) as {
            places: typeof googlePlaces;
            message: string | null;
          };
          setGooglePlaces(res.places ?? []);
          setGoogleMsg(res.message);
        } catch {
          /* ignore */
        }
        })();
      },
      () => toast.error(t.localGeoFail),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      const result = await runParse({
        data: { query: query.trim(), lang: lang === "en" ? "en" : "th" },
      });
      setIntent(result);
      toast.success(t.localSearchDone);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async () => {
    if (!user || !reviewPlaceId) return;
    const { error } = await supabase.from("place_reviews").upsert(
      {
        place_id: reviewPlaceId,
        user_id: user.id,
        rating: reviewStars,
        comment: reviewComment.trim() || null,
      },
      { onConflict: "place_id,user_id" },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.localReviewSaved);
    setReviewPlaceId(null);
    setReviewComment("");
    setReviewStars(5);
    void qc.invalidateQueries({ queryKey: ["local-places"] });
  };

  const placeName = (p: LocalPlace) =>
    lang === "en" && p.name_en ? p.name_en : p.name;

  return (
    <AppShell>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.localTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.localSub}</p>
        </div>
        <Link
          to="/local/merchant"
          className="inline-flex items-center gap-1 text-sm text-primary underline"
        >
          <Store className="size-4" />
          {t.localMerchantLink}
        </Link>
      </header>

      <section className="mb-6 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <p className="text-sm font-medium">{t.localSearchPrompt}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.localSearchPlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
          />
          <Button disabled={busy || query.trim().length < 2} onClick={search}>
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Search className="mr-2 size-4" />
            )}
            {t.localSearch}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            {t.localRadiusKm}
            <Input
              type="number"
              min={1}
              max={50}
              className="h-8 w-16"
              value={radiusKm}
              onChange={(e) => setRadiusKm(Math.max(1, Math.min(50, Number(e.target.value) || 5)))}
            />
          </label>
          <Button size="sm" variant="outline" onClick={useMyLocation}>
            <MapPin className="mr-1 size-3.5" />
            {t.localUseLocation}
          </Button>
          <Button
            size="sm"
            variant={openOnly ? "default" : "outline"}
            onClick={() => setOpenOnly((v) => !v)}
          >
            <Clock className="mr-1 size-3.5" />
            {t.localOpenNow}
          </Button>
          {coords && (
            <Badge variant="secondary">
              {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)}
            </Badge>
          )}
        </div>
        {intent && (
          <p className="text-xs text-muted-foreground">
            {intent.querySummary}
            {intent.budgetMax != null ? ` · ≤ ฿${intent.budgetMax}` : ""}
            {intent.withKids ? ` · ${t.localKids}` : ""}
          </p>
        )}
      </section>

      
      {googlePlaces.length > 0 && (
        <section className="mb-5 space-y-2">
          <h2 className="text-sm font-semibold">Google Places</h2>
          {googleMsg ? <p className="text-xs text-muted-foreground">{googleMsg}</p> : null}
          <ul className="space-y-2">
            {googlePlaces.map((g) => (
              <li key={g.id} className="rounded-xl border border-border bg-card p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{g.name}</span>
                  {g.rating != null ? <Badge variant="secondary">{g.rating}</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">{g.address}</p>
                {g.mapsUrl ? (
                  <a className="mt-1 inline-block text-xs text-primary underline" href={g.mapsUrl} target="_blank" rel="noreferrer">
                    {t.localOpenMap}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
{(dealsQ.data ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Tag className="size-4" />
            {t.localDealsTitle}
          </h2>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {(dealsQ.data ?? []).slice(0, 8).map((d) => (
              <li
                key={d.id}
                className="min-w-[200px] shrink-0 rounded-xl border border-border bg-card p-3 text-sm shadow-soft"
              >
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{d.description}</p>
                {d.discount_label && (
                  <Badge className="mt-1" variant="secondary">
                    {d.discount_label}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">{t.localPlacesTitle}</h2>
        {placesQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.localEmpty}</p>
        ) : (
          ranked.slice(0, 40).map((p) => {
            const deals = dealsByPlace.get(p.id) ?? [];
            const open = isOpenNow(p.open_hours as Record<string, string>);
            const map =
              (p as { maps_url?: string | null }).maps_url ||
              mapsUrl(p.lat, p.lng, placeName(p));
            const dir =
              coords && p.lat != null && p.lng != null
                ? directionsUrl(coords.lat, coords.lng, p.lat, p.lng)
                : null;
            return (
              <article
                key={p.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">
                      {placeName(p)}
                      {p.is_promoted ? (
                        <Badge className="ml-2 align-middle" variant="secondary">
                          {t.localPromoted}
                        </Badge>
                      ) : null}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {p.category}
                      {p.area ? ` · ${p.area}` : ""}
                      {p.distanceKm != null ? ` · ${p.distanceKm.toFixed(1)} km` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-sm">
                    <span className="flex items-center gap-1">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      {Number(p.rating).toFixed(1)}
                      <span className="text-xs text-muted-foreground">({p.review_count})</span>
                    </span>
                    {open === true && (
                      <Badge className="bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">
                        {t.localOpenNow}
                      </Badge>
                    )}
                    {open === false && (
                      <Badge variant="outline" className="text-[10px]">
                        {t.localClosed}
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>
                {p.community_note ? (
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    “{p.community_note}”
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  {(p.tags ?? []).slice(0, 6).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                  {p.is_verified && (
                    <Badge variant="secondary" className="text-xs">
                      {t.localVerified}
                    </Badge>
                  )}
                </div>
                {deals.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
                    {deals.map((d) => (
                      <li key={d.id} className="flex items-center gap-1">
                        <Tag className="size-3 text-primary" />
                        <span className="font-medium">{d.title}</span>
                        {d.discount_label && (
                          <Badge variant="secondary">{d.discount_label}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {map && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={map} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-1 size-3.5" />
                        {t.localMap}
                      </a>
                    </Button>
                  )}
                  {dir && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={dir} target="_blank" rel="noreferrer">
                        <Navigation className="mr-1 size-3.5" />
                        {t.localDirections}
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setReviewPlaceId(p.id);
                      setReviewStars(5);
                      setReviewComment("");
                    }}
                  >
                    <Star className="mr-1 size-3.5" />
                    {t.localReview}
                  </Button>
                </div>
                {reviewPlaceId === p.id && (
                  <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                    <p className="text-sm font-medium">{t.localReviewTitle}</p>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setReviewStars(n)}
                          className="p-0.5"
                          aria-label={`${n}`}
                        >
                          <Star
                            className={`size-6 ${
                              n <= reviewStars
                                ? "fill-amber-400 text-amber-400"
                                : "text-muted-foreground"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    <Textarea
                      rows={2}
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder={t.localReviewPlaceholder}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={submitReview}>
                        {t.localReviewSubmit}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReviewPlaceId(null)}
                      >
                        {t.cancel}
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </AppShell>
  );
}
