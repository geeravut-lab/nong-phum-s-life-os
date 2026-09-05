import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import {
  BENEFIT_GROUPS,
  benefitCategoryLabels,
  benefitTitle,
  groupLabels,
  matchBenefits,
  pickLabel,
  type BenefitProfile,
  type BenefitRow,
  type MatchLevel,
} from "@/lib/benefits";

export const Route = createFileRoute("/_authenticated/benefits")({
  head: () => ({
    meta: [
      { title: "สิทธิฉัน | น้องภูมิ" },
      {
        name: "description",
        content: "เช็กสิทธิและสวัสดิการรัฐที่คุณน่าจะได้รับ พร้อมวิธีขอรับสิทธิและติดตามสถานะ",
      },
      { property: "og:title", content: "สิทธิฉัน | น้องภูมิ" },
      {
        property: "og:description",
        content: "กรอกข้อมูลสั้น ๆ แล้วน้องภูมิจับคู่สิทธิรัฐที่เข้าเกณฑ์ให้อัตโนมัติ",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BenefitsPage,
});

const STATUSES = ["interested", "in_progress", "received"] as const;
type Status = (typeof STATUSES)[number];

const emptyProfile: BenefitProfile = {
  birth_year: null,
  monthly_income: null,
  occupation: null,
  province: null,
  household_size: null,
  groups: [],
  has_social_security: false,
  has_welfare_card: false,
};

function BenefitsPage() {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const [form, setForm] = useState<BenefitProfile>(emptyProfile);
  const [saving, setSaving] = useState(false);

  const profileQ = useQuery({
    queryKey: ["benefit-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("benefit_profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const benefitsQ = useQuery({
    queryKey: ["benefits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("benefits")
        .select("*")
        .eq("is_active", true)
        .order("category");
      if (error) throw error;
      return (data ?? []) as unknown as BenefitRow[];
    },
  });

  const myQ = useQuery({
    queryKey: ["user-benefits", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_benefits")
        .select("benefit_id,status")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const p = profileQ.data;
    if (!p) return;
    setForm({
      birth_year: p.birth_year,
      monthly_income: p.monthly_income,
      occupation: p.occupation,
      province: p.province,
      household_size: p.household_size,
      groups: p.groups ?? [],
      has_social_security: p.has_social_security,
      has_welfare_card: p.has_welfare_card,
    });
  }, [profileQ.data]);

  const hasProfile = !!profileQ.data;
  const matches = matchBenefits(benefitsQ.data ?? [], hasProfile ? form : null);
  const statusOf = (id: string) =>
    (myQ.data?.find((r) => r.benefit_id === id)?.status ?? null) as Status | null;

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("benefit_profiles").upsert(
      {
        user_id: user.id,
        birth_year: form.birth_year,
        monthly_income: form.monthly_income,
        occupation: form.occupation,
        province: form.province,
        household_size: form.household_size,
        groups: form.groups,
        has_social_security: form.has_social_security,
        has_welfare_card: form.has_welfare_card,
      },
      { onConflict: "user_id" },
    );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.benSaved);
    void qc.invalidateQueries({ queryKey: ["benefit-profile", user.id] });
  };

  const setStatus = async (benefitId: string, status: Status) => {
    if (!user) return;
    const current = statusOf(benefitId);
    if (current === status) {
      const { error } = await supabase
        .from("user_benefits")
        .delete()
        .eq("user_id", user.id)
        .eq("benefit_id", benefitId);
      if (error) {
        toast.error(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("user_benefits")
        .upsert({ user_id: user.id, benefit_id: benefitId, status }, { onConflict: "user_id,benefit_id" });
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    void qc.invalidateQueries({ queryKey: ["user-benefits", user.id] });
  };

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const levelBadge: Record<MatchLevel, { label: string; className: string }> = {
    eligible: { label: t.benEligible, className: "bg-primary text-primary-foreground" },
    maybe: { label: t.benMaybe, className: "bg-secondary text-secondary-foreground" },
    not: { label: t.benNot, className: "bg-muted text-muted-foreground" },
  };

  const statusLabel: Record<Status, string> = {
    interested: t.benStatusInterested,
    in_progress: t.benStatusInProgress,
    received: t.benStatusReceived,
  };

  return (
    <AppShell>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t.benTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.benSub}</p>
      </header>

      <section className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <ShieldCheck className="size-4 text-primary" /> {t.benProfile}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="by">{t.benBirthYear}</Label>
            <Input
              id="by"
              inputMode="numeric"
              value={form.birth_year ?? ""}
              onChange={(e) => {
                const raw = num(e.target.value);
                setForm((f) => ({ ...f, birth_year: raw && raw > 2400 ? raw - 543 : raw }));
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inc">{t.benIncome}</Label>
            <Input
              id="inc"
              inputMode="numeric"
              value={form.monthly_income ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, monthly_income: num(e.target.value) }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="occ">{t.benOccupation}</Label>
            <Input
              id="occ"
              value={form.occupation ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value || null }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pv">{t.benProvince}</Label>
            <Input
              id="pv"
              value={form.province ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, province: e.target.value || null }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hh">{t.benHousehold}</Label>
            <Input
              id="hh"
              inputMode="numeric"
              value={form.household_size ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, household_size: num(e.target.value) }))}
            />
          </div>
        </div>

        <div className="mt-4">
          <Label className="mb-2 block">{t.benGroups}</Label>
          <div className="flex flex-wrap gap-2">
            {BENEFIT_GROUPS.map((g) => {
              const on = form.groups.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      groups: on ? f.groups.filter((x) => x !== g) : [...f.groups, g],
                    }))
                  }
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {pickLabel(groupLabels, g, lang)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
            <span className="text-sm">{t.benHasSSO}</span>
            <Switch
              checked={form.has_social_security}
              onCheckedChange={(v) => setForm((f) => ({ ...f, has_social_security: v }))}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
            <span className="text-sm">{t.benHasWelfare}</span>
            <Switch
              checked={form.has_welfare_card}
              onCheckedChange={(v) => setForm((f) => ({ ...f, has_welfare_card: v }))}
            />
          </label>
        </div>

        <Button className="mt-4" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t.benSave}
        </Button>
      </section>

      {!hasProfile ? (
        <p className="mb-4 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t.benEmptyProfile}
        </p>
      ) : null}

      {benefitsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      ) : (
        <div className="grid gap-3">
          {matches.map(({ benefit, level, reasons }) => {
            const mine = statusOf(benefit.id);
            return (
              <article
                key={benefit.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-soft"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{benefitTitle(benefit, lang)}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t.benProvider}: {benefit.provider} ·{" "}
                      {pickLabel(benefitCategoryLabels, benefit.category, lang)}
                    </p>
                  </div>
                  <Badge className={levelBadge[level].className}>{levelBadge[level].label}</Badge>
                </div>

                <p className="mt-2 text-sm text-muted-foreground">{benefit.summary}</p>

                {benefit.est_value != null ? (
                  <p className="mt-1 text-sm">
                    {t.benEstValue}: {Number(benefit.est_value).toLocaleString()} {t.baht}
                  </p>
                ) : null}

                {reasons.length ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {reasons.map((r, i) => (
                      <li key={i}>{lang === "en" ? r.en : r.th}</li>
                    ))}
                  </ul>
                ) : null}

                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium">{t.benHowTo}</summary>
                  <p className="mt-1 whitespace-pre-line text-muted-foreground">{benefit.how_to}</p>
                  {benefit.link ? (
                    <a
                      href={benefit.link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-primary underline"
                    >
                      {t.benLink} <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </details>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t.benMyStatus}:</span>
                  {STATUSES.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={mine === s ? "default" : "outline"}
                      onClick={() => setStatus(benefit.id, s)}
                    >
                      {statusLabel[s]}
                    </Button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
