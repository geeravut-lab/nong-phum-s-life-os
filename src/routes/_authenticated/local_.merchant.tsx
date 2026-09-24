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
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import { PLACE_CATEGORIES, type LocalPlace } from "@/lib/local.shared";

export const Route = createFileRoute("/_authenticated/local_/merchant")({
  head: () => ({ meta: routeMeta("local") }),
  component: MerchantDashboardPage,
});

function MerchantDashboardPage() {
  const { t } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "food",
    description: "",
    area: "",
    address: "",
    lat: "",
    lng: "",
    tags: "",
    price_level: "2",
    phone: "",
  });
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

  const savePlace = async () => {
    if (!user || !form.name.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("local_places").insert({
      owner_user_id: user.id,
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim(),
      area: form.area.trim() || null,
      address: form.address.trim() || null,
      lat: form.lat ? Number(form.lat) : null,
      lng: form.lng ? Number(form.lng) : null,
      tags: form.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      price_level: Number(form.price_level) || null,
      phone: form.phone.trim() || null,
      is_active: true,
    });
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
      lat: "",
      lng: "",
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
    const { error } = await supabase.from("local_deals").insert({
      place_id: dealForm.placeId,
      title: dealForm.title.trim(),
      description: dealForm.description.trim(),
      discount_label: dealForm.discount_label.trim() || null,
      budget_max: dealForm.budget_max ? Number(dealForm.budget_max) : null,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      is_active: true,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.localDealSaved);
    setDealForm({
      placeId: dealForm.placeId,
      title: "",
      description: "",
      discount_label: "",
      budget_max: "",
    });
    void qc.invalidateQueries({ queryKey: ["my-local-deals"] });
    void qc.invalidateQueries({ queryKey: ["local-deals"] });
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
          <div>
            <Label>Lat</Label>
            <Input
              className="mt-1"
              value={form.lat}
              onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
              placeholder="13.65"
            />
          </div>
          <div>
            <Label>Lng</Label>
            <Input
              className="mt-1"
              value={form.lng}
              onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
              placeholder="100.68"
            />
          </div>
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
        <Button disabled={busy} onClick={savePlace}>
          {t.localSavePlace}
        </Button>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="font-semibold">{t.localMyPlaces}</h2>
        {(myPlaces.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.localNoPlaces}</p>
        ) : (
          (myPlaces.data ?? []).map((p) => (
            <article key={p.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                <Badge variant="outline">{p.category}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{p.area}</p>
            </article>
          ))
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
              onChange={(e) =>
                setDealForm((f) => ({ ...f, discount_label: e.target.value }))
              }
            />
            <Input
              type="number"
              placeholder={t.localBudgetMax}
              value={dealForm.budget_max}
              onChange={(e) => setDealForm((f) => ({ ...f, budget_max: e.target.value }))}
            />
          </div>
          <Button disabled={busy} onClick={saveDeal}>
            {t.localSaveDeal}
          </Button>
          <ul className="space-y-1 text-sm">
            {(myDeals.data ?? []).map((d) => (
              <li key={d.id} className="rounded-lg border border-border px-2 py-1">
                {d.title}{" "}
                {d.discount_label && (
                  <Badge variant="secondary" className="ml-1">
                    {d.discount_label}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
