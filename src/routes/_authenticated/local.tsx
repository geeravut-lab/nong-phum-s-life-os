import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { MapPin, Search, Store, Tag, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { parseLocalQuery } from "@/lib/local.functions";
import {
  rankPlaces,
  type LocalDeal,
  type LocalPlace,
  type LocalSearchIntent,
} from "@/lib/local.shared";

export const Route = createFileRoute("/_authenticated/local")({
  head: () => ({ meta: routeMeta("local") }),
  component: LocalPage,
});

function LocalPage() {
  const { t, lang } = useI18n();
  const runParse = useServerFn(parseLocalQuery);

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<LocalSearchIntent | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const placesQ = useQuery({
    queryKey: ["local-places"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("local_places")
        .select("*")
        .eq("is_active", true)
        .order("rating", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as LocalPlace[];
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
    const places = placesQ.data ?? [];
    if (!intent) {
      return places.map((p) => ({
        ...p,
        distanceKm:
          coords && p.lat != null && p.lng != null
            ? rankPlaces([p], {
                categories: [],
                tags: [],
                budgetMax: null,
                areaHint: null,
                withKids: false,
                openEvening: false,
                querySummary: "",
              }, coords.lat, coords.lng)[0]?.distanceKm ?? null
            : null,
        score: Number(p.rating) * 10,
      }));
    }
    return rankPlaces(places, intent, coords?.lat ?? null, coords?.lng ?? null);
  }, [placesQ.data, intent, coords]);

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
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        toast.success(t.localGeoOk);
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

      {/* AI search */}
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
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={useMyLocation}>
            <MapPin className="mr-1 size-3.5" />
            {t.localUseLocation}
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
            {intent.categories.length
              ? ` · ${intent.categories.join(", ")}`
              : ""}
          </p>
        )}
      </section>

      {/* Active deals strip */}
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

      {/* Places */}
      <section className="space-y-3">
        <h2 className="font-semibold">{t.localPlacesTitle}</h2>
        {placesQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.localEmpty}</p>
        ) : (
          ranked.slice(0, 30).map((p) => {
            const deals = dealsByPlace.get(p.id) ?? [];
            return (
              <article
                key={p.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">{placeName(p)}</h3>
                    <p className="text-xs text-muted-foreground">
                      {p.category}
                      {p.area ? ` · ${p.area}` : ""}
                      {p.distanceKm != null
                        ? ` · ${p.distanceKm.toFixed(1)} km`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <Star className="size-3.5 fill-amber-400 text-amber-400" />
                    {Number(p.rating).toFixed(1)}
                    <span className="text-xs text-muted-foreground">
                      ({p.review_count})
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>
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
                {p.price_level != null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {"฿".repeat(p.price_level)}
                    {"฿".repeat(Math.max(0, 4 - p.price_level)).replace(/฿/g, "·")}
                  </p>
                )}
              </article>
            );
          })
        )}
      </section>
    </AppShell>
  );
}
