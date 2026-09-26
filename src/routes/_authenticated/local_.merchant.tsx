import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { DAY_KEYS } from "@/lib/local-hours";
import { useAuthUser } from "@/hooks/useAuthUser";
import {
  deleteLocalEvent,
  listUpcomingLocalEvents,
  upsertLocalEvent,
  type LocalEventRow,
} from "@/lib/local-events.functions";
import { useI18n } from "@/lib/i18n";
import { PLACE_CATEGORIES, type LocalPlace } from "@/lib/local.shared";

function parseMapsUrl(url: string): { lat: number; lng: number } | null {
  try {
    const u = url.trim();
    const at = u.match(/@(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
    if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
    const q = u.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (q) return { lat: Number(q[1]), lng: Number(q[2]) };
    const ll = u.match(/[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (ll) return { lat: Number(ll[1]), lng: Number(ll[2]) };
    const dapi = u.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
    if (dapi) return { lat: Number(dapi[1]), lng: Number(dapi[2]) };
  } catch {
    /* ignore */
  }
  return null;
}

export const Route = createFileRoute("/_authenticated/local_/merchant")({
  head: () => ({ meta: routeMeta("local") }),
  component: MerchantDashboardPage,
});

function MerchantDashboardPage() {
  const { t } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "food",
    description: "",
    area: "",
    address: "",
    maps_url: "",
    is_public: true,
    tags: "",
    price_level: "2",
    phone: "",
  });
  const [dealStart, setDealStart] = useState("");
  const [dealEnd, setDealEnd] = useState("");
  const [dealForm, setDealForm] = useState({
    placeId: "",
    title: "",
    description: "",
    discount_label: "",
    budget_max: "",
  });

  const myPlaces = useQuery({
    queryKey: ["my-local-places", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("local_places")
        .select("*")
        .eq("owner_user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LocalPlace[];
    },
  });

  const myDeals = useQuery({
    queryKey: ["my-local-deals", user?.id],
    enabled: !!user && (myPlaces.data?.length ?? 0) > 0,
    queryFn: async () => {
      const ids = (myPlaces.data ?? []).map((p) => p.id);
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("local_deals")
        .select("*")
        .in("place_id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const runListEvents = useServerFn(listUpcomingLocalEvents);
  const runUpsertEvent = useServerFn(upsertLocalEvent);
  const runDeleteEvent = useServerFn(deleteLocalEvent);
  const [evtName, setEvtName] = useState("");
  const [evtWhen, setEvtWhen] = useState("");
  const [evtMin, setEvtMin] = useState("");
  const [evtMax, setEvtMax] = useState("");
  const [evtKids, setEvtKids] = useState(false);
  const [evtPlace, setEvtPlace] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [evtEnd, setEvtEnd] = useState("");

  // Per-day opening hours for the place form. Unticked = closed that day.
  const [hours, setHours] = useState<Record<string, { on: boolean; open: string; close: string }>>(
    () =>
      Object.fromEntries(
        DAY_KEYS.map((d) => [d, { on: false, open: "09:00", close: "22:00" }]),
      ) as Record<string, { on: boolean; open: string; close: string }>,
  );

  const myEvents = useQuery({
    enabled: !!user,
    queryKey: ["my-local-events", user?.id],
    queryFn: async () => {
      const res = (await runListEvents({ data: { withinDays: 90, mineOnly: true } })) as {
        events: LocalEventRow[];
      };
      return res.events ?? [];
    },
  });

  const resetEventForm = () => {
    setEditingEventId(null);
    setEvtName("");
    setEvtWhen("");
    setEvtEnd("");
    setEvtMin("");
    setEvtMax("");
    setEvtKids(false);
    setEvtPlace("");
  };

  const startEditEvent = (e: LocalEventRow) => {
    setEditingEventId(e.id);
    setEvtName(e.title);
    // datetime-local wants local wall-clock, not UTC.
    const d = new Date(e.startsAt);
    setEvtWhen(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    if (e.endsAt) {
      const de = new Date(e.endsAt);
      setEvtEnd(new Date(de.getTime() - de.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    } else {
      setEvtEnd("");
    }
    setEvtMin(e.priceMin != null ? String(e.priceMin) : "");
    setEvtMax(e.priceMax != null ? String(e.priceMax) : "");
    setEvtKids(e.kidFriendly);
    setEvtPlace(e.placeId ?? "");
  };

  const addEvent = async () => {
    if (!evtName.trim() || !evtWhen) return;
    // An event has to happen somewhere: without a place it has no address and
    // no pin, and the route built from it sends people nowhere.
    if (!evtPlace) {
      toast.error(t.evtPlaceRequired);
      return;
    }
    setBusy(true);
    try {
      await runUpsertEvent({
        data: {
          ...(editingEventId ? { id: editingEventId } : {}),
          title: evtName.trim(),
          startsAt: new Date(evtWhen).toISOString(),
          ...(evtEnd ? { endsAt: new Date(evtEnd).toISOString() } : {}),
          placeId: evtPlace,
          ...(evtMin ? { priceMin: Number(evtMin) } : {}),
          ...(evtMax ? { priceMax: Number(evtMax) } : {}),
          kidFriendly: evtKids,
        },
      });
      resetEventForm();
      toast.success(t.saved);
      void qc.invalidateQueries({ queryKey: ["my-local-events", user?.id] });
      void qc.invalidateQueries({ queryKey: ["local-events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async (id: string) => {
    if (!window.confirm(t.evtDeleteConfirm)) return;
    setBusy(true);
    try {
      await runDeleteEvent({ data: { id } });
      void qc.invalidateQueries({ queryKey: ["my-local-events", user?.id] });
      void qc.invalidateQueries({ queryKey: ["local-events"] });
      toast.success(t.saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  /** hours state -> open_hours json. Unticked days are stored as null = closed. */
  const hoursToJson = () => {
    const anyOn = DAY_KEYS.some((d) => hours[d]?.on);
    if (!anyOn) return null; // nothing set: keep "unknown" rather than "closed all week"
    return Object.fromEntries(
      DAY_KEYS.map((d) => {
        const h = hours[d];
        return [d, h?.on ? { open: h.open, close: h.close } : null];
      }),
    );
  };

  /** open_hours json -> hours state, accepting the legacy single-window shape. */
  const jsonToHours = (raw: unknown) => {
    const base = Object.fromEntries(
      DAY_KEYS.map((d) => [d, { on: false, open: "09:00", close: "22:00" }]),
    ) as Record<string, { on: boolean; open: string; close: string }>;
    if (!raw || typeof raw !== "object") return base;
    const o = raw as Record<string, unknown>;
    const hasPerDay = DAY_KEYS.some((d) => d in o);
    if (hasPerDay) {
      for (const d of DAY_KEYS) {
        const v = o[d] as { open?: string; close?: string } | null | undefined;
        if (v && typeof v === "object" && v.open && v.close) {
          base[d] = { on: true, open: v.open, close: v.close };
        }
      }
      return base;
    }
    // legacy: one window applied to every day
    const open = o["open"] as string | undefined;
    const close = o["close"] as string | undefined;
    if (open && close) for (const d of DAY_KEYS) base[d] = { on: true, open, close };
    return base;
  };

  const savePlace = async () => {
    if (!user || !form.name.trim()) return;
    setBusy(true);
    if (editingPlaceId) {
      const { error } = await supabase
        .from("local_places")
        .update({
          name: form.name.trim(),
          category: form.category,
          description: form.description.trim(),
          area: form.area.trim() || null,
          phone: form.phone.trim() || null,
          price_level: Number(form.price_level) || 2,
          open_hours: hoursToJson(),
          tags: form.tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          lat: parseMapsUrl(form.maps_url)?.lat ?? null,
          lng: parseMapsUrl(form.maps_url)?.lng ?? null,
          maps_url: form.maps_url.trim() || null,
          is_public: form.is_public,
        } as never)
        .eq("id", editingPlaceId);
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(t.saved);
      setEditingPlaceId(null);
      setForm({
        name: "",
        category: form.category,
        description: "",
        area: "",
        address: "",
        phone: "",
        price_level: "2",
        tags: "",
        maps_url: "",
        is_public: true,
      });
      void qc.invalidateQueries({ queryKey: ["my-local-places"] });
      void qc.invalidateQueries({ queryKey: ["local-places"] });
      return;
    }
    const { error } = await supabase.from("local_places").insert({
      owner_user_id: user.id,
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim(),
      area: form.area.trim() || null,
      address: form.address.trim() || null,
      lat: parseMapsUrl(form.maps_url)?.lat ?? null,
      lng: parseMapsUrl(form.maps_url)?.lng ?? null,
      maps_url: form.maps_url.trim() || null,
      is_public: form.is_public,
      tags: form.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      price_level: Number(form.price_level) || null,
      open_hours: hoursToJson(),
      phone: form.phone.trim() || null,
      is_active: true,
    } as never);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.localPlaceSaved);
    setForm({
      name: "",
      category: "food",
      description: "",
      area: "",
      address: "",
      maps_url: "",
      is_public: true,
      tags: "",
      price_level: "2",
      phone: "",
    });
    void qc.invalidateQueries({ queryKey: ["my-local-places"] });
    void qc.invalidateQueries({ queryKey: ["local-places"] });
  };

  const saveDeal = async () => {
    if (!dealForm.placeId || !dealForm.title.trim()) return;
    setBusy(true);
    try {
      if (editingDealId) {
        const { error } = await supabase
          .from("local_deals")
          .update({
            title: dealForm.title.trim(),
            description: dealForm.description.trim(),
            discount_label: dealForm.discount_label.trim() || null,
            budget_max: dealForm.budget_max ? Number(dealForm.budget_max) : null,
            starts_at: dealStart ? new Date(dealStart).toISOString() : null,
            ends_at: dealEnd ? new Date(dealEnd).toISOString() : null,
          } as never)
          .eq("id", editingDealId);
        if (error) throw error;
        setEditingDealId(null);
      } else {
        const { error } = await supabase.from("local_deals").insert({
          place_id: dealForm.placeId,
          title: dealForm.title.trim(),
          description: dealForm.description.trim(),
          discount_label: dealForm.discount_label.trim() || null,
          budget_max: dealForm.budget_max ? Number(dealForm.budget_max) : null,
          // Blank means no limit that way, rather than a silent 30-day guess.
          starts_at: dealStart ? new Date(dealStart).toISOString() : null,
          ends_at: dealEnd ? new Date(dealEnd).toISOString() : null,
          is_active: true,
        });
        if (error) throw error;
      }
      toast.success(t.localDealSaved);
      setDealStart("");
      setDealEnd("");
      setDealForm({
        placeId: dealForm.placeId,
        title: "",
        description: "",
        discount_label: "",
        budget_max: "",
      });
      void qc.invalidateQueries({ queryKey: ["my-local-deals"] });
      void qc.invalidateQueries({ queryKey: ["local-deals"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const deletePlace = async (id: string) => {
    // local_deals.place_id is ON DELETE CASCADE, so the promotions go with it.
    if (!window.confirm(t.localDeletePlaceConfirm)) return;
    const { error } = await supabase
      .from("local_places")
      .delete()
      .eq("id", id)
      .eq("owner_user_id", user!.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (editingPlaceId === id) setEditingPlaceId(null);
    void qc.invalidateQueries({ queryKey: ["my-local-places", user?.id] });
    void qc.invalidateQueries({ queryKey: ["my-local-deals"] });
    void qc.invalidateQueries({ queryKey: ["local-deals"] });
    void qc.invalidateQueries({ queryKey: ["local-places"] });
    toast.success(t.saved);
  };

  const deleteDeal = async (id: string) => {
    if (!window.confirm(t.localDeleteDealConfirm)) return;
    const { error } = await supabase.from("local_deals").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      void qc.invalidateQueries({ queryKey: ["my-local-deals"] });
      void qc.invalidateQueries({ queryKey: ["local-deals"] });
      toast.success(t.saved);
    }
  };

  const toLocal = (iso: string | null | undefined) =>
    iso
      ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : "";

  const startEditDeal = (d: {
    id: string;
    place_id: string;
    title: string;
    description: string | null;
    discount_label: string | null;
    budget_max: number | null;
    starts_at?: string | null;
    ends_at?: string | null;
  }) => {
    setEditingDealId(d.id);
    setDealForm({
      placeId: d.place_id,
      title: d.title,
      description: d.description ?? "",
      discount_label: d.discount_label ?? "",
      budget_max: d.budget_max != null ? String(d.budget_max) : "",
    });
    setDealStart(toLocal(d.starts_at));
    setDealEnd(toLocal(d.ends_at));
  };

  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">
          <Link to="/local" className="underline">
            {t.localTitle}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.localMerchantTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.localMerchantSub}</p>
      </header>

      <section className="mb-8 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="font-semibold">{t.localAddPlace}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>{t.localPlaceName}</Label>
            <Input
              className="mt-1"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <Label>{t.localCategory}</Label>
            <Select
              value={form.category}
              onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLACE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t.localPriceLevel}</Label>
            <Select
              value={form.price_level}
              onValueChange={(v) => setForm((f) => ({ ...f, price_level: v }))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {"฿".repeat(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t.localArea}</Label>
            <Input
              className="mt-1"
              value={form.area}
              onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
            />
          </div>
          <div>
            <Label>{t.localPhone}</Label>
            <Input
              className="mt-1"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>{t.localDescription}</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>{t.localMapsLink}</Label>
            <Input
              className="mt-1"
              placeholder="https://maps.google.com/..."
              value={form.maps_url}
              onChange={(e) => setForm((f) => ({ ...f, maps_url: e.target.value }))}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">{t.localMapsLinkHint}</p>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))}
            />
            {t.localSharePublic}
          </label>
          <div className="sm:col-span-2">
            <Label>{t.localTags}</Label>
            <Input
              className="mt-1"
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="family, kids, outdoor"
            />
          </div>
        </div>
        <div className="mb-3 rounded-xl border border-border p-3">
          <p className="mb-1 text-sm font-medium">{t.hoursTitle}</p>
          <p className="mb-2 text-xs text-muted-foreground">{t.hoursNote}</p>
          <div className="space-y-1.5">
            {DAY_KEYS.map((d) => {
              const label = {
                sun: t.daySun,
                mon: t.dayMon,
                tue: t.dayTue,
                wed: t.dayWed,
                thu: t.dayThu,
                fri: t.dayFri,
                sat: t.daySat,
              }[d];
              const h = hours[d] ?? { on: false, open: "09:00", close: "22:00" };
              return (
                <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex w-28 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={h.on}
                      onChange={(e) =>
                        setHours((cur) => ({ ...cur, [d]: { ...h, on: e.target.checked } }))
                      }
                    />
                    {label}
                  </label>
                  <Input
                    type="time"
                    className="w-28"
                    aria-label={`${label} ${t.hoursFrom}`}
                    value={h.open}
                    disabled={!h.on}
                    onChange={(e) =>
                      setHours((cur) => ({ ...cur, [d]: { ...h, open: e.target.value } }))
                    }
                  />
                  <span className="text-xs text-muted-foreground">{t.hoursTo}</span>
                  <Input
                    type="time"
                    className="w-28"
                    aria-label={`${label} ${t.hoursTo}`}
                    value={h.close}
                    disabled={!h.on}
                    onChange={(e) =>
                      setHours((cur) => ({ ...cur, [d]: { ...h, close: e.target.value } }))
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>

        <Button disabled={busy} onClick={savePlace}>
          {t.localSavePlace}
        </Button>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="font-semibold">{t.localMyPlaces}</h2>
        {(myPlaces.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.localNoPlaces}</p>
        ) : (
          (myPlaces.data ?? []).map((p) => {
            const maps =
              (p as { maps_url?: string | null }).maps_url ||
              (p.lat != null && p.lng != null
                ? `https://www.google.com/maps?q=${p.lat},${p.lng}`
                : null);
            return (
              <article key={p.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline">{p.category}</Badge>
                    {maps ? (
                      <Button size="sm" variant="outline" asChild>
                        <a href={maps} target="_blank" rel="noreferrer">
                          {t.localOpenMap}
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingPlaceId(p.id);
                        setHours(jsonToHours((p as { open_hours?: unknown }).open_hours));
                        setForm({
                          name: p.name ?? "",
                          category: p.category ?? "cafe",
                          description: p.description ?? "",
                          area: p.area ?? "",
                          address: (p as { address?: string | null }).address ?? "",
                          phone: p.phone ?? "",
                          price_level: String(p.price_level ?? 2),
                          tags: Array.isArray(p.tags) ? p.tags.join(", ") : "",
                          maps_url: (p as { maps_url?: string | null }).maps_url ?? "",
                          is_public: (p as { is_public?: boolean }).is_public !== false,
                        });
                      }}
                    >
                      {t.edit}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void deletePlace(p.id)}>
                      {t.delete}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{p.area}</p>
              </article>
            );
          })
        )}
      </section>

      {/* Events for this merchant's places - the time-bound half of Local */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="mb-2 text-sm font-semibold">{t.evtManage}</h2>

        <div className="space-y-2 border-t border-border pt-3">
          <Input
            placeholder={t.evtName}
            value={evtName}
            onChange={(e) => setEvtName(e.target.value)}
          />
          <label className="block text-xs text-muted-foreground">
            {t.evtStartLabel}
            <Input
              type="datetime-local"
              step={60}
              lang="en-GB"
              aria-label={t.evtStartLabel}
              value={evtWhen}
              onChange={(e) => setEvtWhen(e.target.value)}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            {t.evtEndLabel}
            <Input
              type="datetime-local"
              step={60}
              lang="en-GB"
              aria-label={t.evtEndLabel}
              value={evtEnd}
              onChange={(e) => setEvtEnd(e.target.value)}
            />
          </label>
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={evtPlace}
            onChange={(e) => setEvtPlace(e.target.value)}
            aria-label={t.localMyPlaces ?? "place"}
          >
            <option value="">—</option>
            {(myPlaces.data ?? []).map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              placeholder={t.evtPriceMin}
              value={evtMin}
              onChange={(e) => setEvtMin(e.target.value)}
            />
            <Input
              type="number"
              min={0}
              placeholder={t.evtPriceMax}
              value={evtMax}
              onChange={(e) => setEvtMax(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={evtKids}
              onChange={(e) => setEvtKids(e.target.checked)}
            />
            {t.evtKidFriendly}
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !evtName.trim() || !evtWhen || !evtPlace}
              onClick={() => void addEvent()}
            >
              {editingEventId ? t.save : t.evtAdd}
            </Button>
            {editingEventId ? (
              <Button size="sm" variant="ghost" onClick={resetEventForm}>
                {t.cancel}
              </Button>
            ) : null}
          </div>
        </div>

        {(myEvents.data ?? []).length === 0 ? (
          <p className="mb-3 text-xs text-muted-foreground">{t.evtMineNone}</p>
        ) : (
          <ul className="mb-3 space-y-2 text-sm">
            {(myEvents.data ?? []).map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2"
              >
                <span>
                  <span className="font-medium">{e.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {new Date(e.startsAt).toLocaleString()}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => startEditEvent(e)}
                  >
                    {t.edit}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void removeEvent(e.id)}
                  >
                    {t.delete}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(myPlaces.data ?? []).length > 0 && (
        <section className="mb-8 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="font-semibold">{t.localAddDeal}</h2>
          <div>
            <Label>{t.localPlaceName}</Label>
            <Select
              value={dealForm.placeId}
              onValueChange={(v) => setDealForm((f) => ({ ...f, placeId: v }))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {(myPlaces.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder={t.localDealTitle}
            value={dealForm.title}
            onChange={(e) => setDealForm((f) => ({ ...f, title: e.target.value }))}
          />
          <Textarea
            rows={2}
            placeholder={t.localDealDesc}
            value={dealForm.description}
            onChange={(e) => setDealForm((f) => ({ ...f, description: e.target.value }))}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder={t.localDiscount}
              value={dealForm.discount_label}
              onChange={(e) => setDealForm((f) => ({ ...f, discount_label: e.target.value }))}
            />
            <Input
              type="number"
              placeholder={t.localBudgetMax}
              value={dealForm.budget_max}
              onChange={(e) => setDealForm((f) => ({ ...f, budget_max: e.target.value }))}
            />
          </div>
          <div className="mb-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-muted-foreground">
              {t.dealStartLabel}
              <Input
                type="datetime-local"
                step={60}
                lang="en-GB"
                aria-label={t.dealStartLabel}
                value={dealStart}
                onChange={(e) => setDealStart(e.target.value)}
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              {t.dealEndLabel}
              <Input
                type="datetime-local"
                step={60}
                lang="en-GB"
                aria-label={t.dealEndLabel}
                value={dealEnd}
                onChange={(e) => setDealEnd(e.target.value)}
              />
            </label>
          </div>
          <Button disabled={busy} onClick={saveDeal}>
            {t.localSaveDeal}
          </Button>
          <ul className="mt-3 space-y-2 text-sm">
            {(myDeals.data ?? []).map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <div>
                  <span className="font-medium">{d.title}</span>{" "}
                  {d.discount_label && (
                    <Badge variant="secondary" className="ml-1">
                      {d.discount_label}
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      startEditDeal({
                        id: d.id,
                        place_id: d.place_id,
                        title: d.title,
                        description: d.description,
                        discount_label: d.discount_label,
                        budget_max: d.budget_max,
                      })
                    }
                  >
                    {t.edit}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => void deleteDeal(d.id)}
                  >
                    {t.delete ?? "ลบ"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
