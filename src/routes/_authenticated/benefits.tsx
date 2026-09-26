import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Sparkles, Bell, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import { interviewBenefits } from "@/lib/benefits.functions";
import {
  BENEFIT_GROUPS,
  benefitCategoryLabels,
  benefitTitle,
  groupLabels,
  matchBenefits,
  pickLabel,
  upcomingDeadlines,
  type BenefitGroup,
  type BenefitProfile,
  type BenefitRow,
  type MatchLevel,
} from "@/lib/benefits";

export const Route = createFileRoute("/_authenticated/benefits")({
  head: () => ({ meta: routeMeta("benefits") }),
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
  const runInterview = useServerFn(interviewBenefits);

  const [form, setForm] = useState<BenefitProfile>(emptyProfile);
  const [saving, setSaving] = useState(false);

  // AI interview state
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [interviewText, setInterviewText] = useState("");
  const [followUps, setFollowUps] = useState<Array<{ id: string; question: string }>>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [interviewBusy, setInterviewBusy] = useState(false);
  const [interviewSummary, setInterviewSummary] = useState<string | null>(null);

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

  const userBenefitsQ = useQuery({
    queryKey: ["user-benefits", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_benefits")
        .select("benefit_id, status, notes, deadline_at, remind")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!profileQ.data) return;
    const d = profileQ.data;
    setForm({
      birth_year: d.birth_year,
      monthly_income: d.monthly_income != null ? Number(d.monthly_income) : null,
      occupation: d.occupation,
      province: d.province,
      household_size: d.household_size,
      groups: (d.groups ?? []) as BenefitGroup[],
      has_social_security: !!d.has_social_security,
      has_welfare_card: !!d.has_welfare_card,
    });
  }, [profileQ.data]);

  const matches = useMemo(() => matchBenefits(benefitsQ.data ?? [], form), [benefitsQ.data, form]);

  const deadlines = useMemo(() => upcomingDeadlines(matches), [matches]);

  const statusOf = (benefitId: string): Status | null => {
    const row = (userBenefitsQ.data ?? []).find((u) => u.benefit_id === benefitId);
    return (row?.status as Status) ?? null;
  };

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      birth_year: form.birth_year,
      monthly_income: form.monthly_income,
      occupation: form.occupation,
      province: form.province,
      household_size: form.household_size,
      groups: form.groups,
      has_social_security: form.has_social_security,
      has_welfare_card: form.has_welfare_card,
    };
    const { error } = await supabase.from("benefit_profiles").upsert(payload, {
      onConflict: "user_id",
    });
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
    const { error } = await supabase
      .from("user_benefits")
      .upsert(
        { user_id: user.id, benefit_id: benefitId, status },
        { onConflict: "user_id,benefit_id" },
      );
    if (error) {
      toast.error(error.message);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["user-benefits", user.id] });
  };

  const runAiInterview = async () => {
    setInterviewBusy(true);
    try {
      const result = await runInterview({
        data: {
          message: interviewText.trim() || null,
          answers: Object.keys(answers).length ? answers : undefined,
          lang: lang === "en" ? "en" : "th",
        },
      });
      const p = result.profile;
      setForm((f) => ({
        ...f,
        birth_year: p.birth_year ?? f.birth_year,
        monthly_income: p.monthly_income ?? f.monthly_income,
        occupation: p.occupation ?? f.occupation,
        province: p.province ?? f.province,
        household_size: p.household_size ?? f.household_size,
        groups: p.groups.length ? (p.groups as BenefitGroup[]) : f.groups,
        has_social_security:
          p.has_social_security != null ? p.has_social_security : f.has_social_security,
        has_welfare_card: p.has_welfare_card != null ? p.has_welfare_card : f.has_welfare_card,
      }));
      setInterviewSummary(result.summary);
      if (result.needsMoreInfo && result.followUpQuestions?.length) {
        setFollowUps(result.followUpQuestions);
        toast.message(t.benInterviewNeedMore);
      } else {
        setFollowUps([]);
        toast.success(t.benInterviewDone);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setInterviewBusy(false);
    }
  };

  const createDeadlineReminder = async (item: {
    benefit: BenefitRow;
    date: Date | null;
    note: string | null;
  }) => {
    if (!user) return;
    const title =
      lang === "en"
        ? `Benefit deadline: ${benefitTitle(item.benefit, lang)}`
        : `กำหนดสิทธิ: ${benefitTitle(item.benefit, lang)}`;
    const due =
      item.date?.toISOString() ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("reminders").insert({
      user_id: user.id,
      title,
      notes: item.note ?? item.benefit.how_to?.slice(0, 300) ?? null,
      due_at: due,
      priority: "high",
      status: "open",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    // mark user_benefit remind
    await supabase.from("user_benefits").upsert(
      {
        user_id: user.id,
        benefit_id: item.benefit.id,
        status: statusOf(item.benefit.id) ?? "interested",
        remind: true,
        deadline_at: item.date ? item.date.toISOString().slice(0, 10) : null,
      },
      { onConflict: "user_id,benefit_id" },
    );
    toast.success(t.benReminderCreated);
    void qc.invalidateQueries({ queryKey: ["user-benefits", user.id] });
  };

  const toggleGroup = (g: BenefitGroup) => {
    setForm((f) => ({
      ...f,
      groups: f.groups.includes(g) ? f.groups.filter((x) => x !== g) : [...f.groups, g],
    }));
  };

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
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t.benTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.benSub}</p>
      </header>

      {/* AI Interview */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t.benInterviewTitle}</h2>
            <p className="text-xs text-muted-foreground">{t.benInterviewSub}</p>
          </div>
          <Button
            size="sm"
            variant={interviewOpen ? "secondary" : "default"}
            onClick={() => setInterviewOpen((v) => !v)}
          >
            <Sparkles className="mr-1 size-3.5" />
            {interviewOpen ? t.benInterviewHide : t.benInterviewStart}
          </Button>
        </div>
        {interviewOpen && (
          <div className="mt-4 space-y-3">
            <Textarea
              rows={3}
              value={interviewText}
              onChange={(e) => setInterviewText(e.target.value)}
              placeholder={t.benInterviewPlaceholder}
              maxLength={2000}
            />
            {followUps.map((fq) => (
              <div key={fq.id}>
                <Label className="text-sm">{fq.question}</Label>
                <Input
                  className="mt-1"
                  value={answers[fq.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [fq.id]: e.target.value }))}
                />
              </div>
            ))}
            {interviewSummary && (
              <p className="text-sm text-muted-foreground">
                {t.benInterviewSummary}: {interviewSummary}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={interviewBusy} onClick={runAiInterview}>
                {interviewBusy ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t.benInterviewRunning}
                  </>
                ) : (
                  t.benInterviewRun
                )}
              </Button>
              <Button variant="outline" disabled={saving} onClick={saveProfile}>
                {t.benSaveProfile}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Upcoming deadlines */}
      {deadlines.length > 0 && (
        <section className="mb-6 space-y-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarClock className="size-4" />
            {t.benDeadlinesTitle}
          </h2>
          <ul className="space-y-2">
            {deadlines.map((d) => (
              <li
                key={d.benefit.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{benefitTitle(d.benefit, lang)}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.date
                      ? d.date.toLocaleDateString(lang === "en" ? "en-GB" : "th-TH")
                      : t.benDeadlineFlexible}
                    {d.daysLeft != null ? ` · ${t.benDaysLeft(d.daysLeft)}` : ""}
                    {d.note ? ` — ${d.note}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => createDeadlineReminder(d)}>
                  <Bell className="mr-1 size-3.5" />
                  {t.benAddReminder}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Profile form */}
      <section className="mb-8 space-y-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="font-semibold">{t.benProfile}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{t.benBirthYear}</Label>
            <Input
              type="number"
              className="mt-1"
              value={form.birth_year ?? ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  birth_year: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </div>
          <div>
            <Label>{t.benIncome}</Label>
            <Input
              type="number"
              className="mt-1"
              value={form.monthly_income ?? ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  monthly_income: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </div>
          <div>
            <Label>{t.benOccupation}</Label>
            <Input
              className="mt-1"
              value={form.occupation ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value || null }))}
            />
          </div>
          <div>
            <Label>{t.benProvince}</Label>
            <Input
              className="mt-1"
              value={form.province ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, province: e.target.value || null }))}
            />
          </div>
          <div>
            <Label>{t.benHousehold}</Label>
            <Input
              type="number"
              className="mt-1"
              value={form.household_size ?? ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  household_size: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {BENEFIT_GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => toggleGroup(g)}
              className={
                form.groups.includes(g)
                  ? "rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground"
                  : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
              }
            >
              {pickLabel(lang, groupLabels[g].th, groupLabels[g].en)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.has_social_security}
              onCheckedChange={(v) => setForm((f) => ({ ...f, has_social_security: v }))}
            />
            {t.benHasSso}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.has_welfare_card}
              onCheckedChange={(v) => setForm((f) => ({ ...f, has_welfare_card: v }))}
            />
            {t.benHasWelfare}
          </label>
        </div>
        <Button disabled={saving} onClick={saveProfile}>
          {saving ? t.benInterviewRunning : t.benSaveProfile}
        </Button>
      </section>

      {/* Matches */}
      <section className="space-y-3">
        <h2 className="font-semibold">{t.benMatches}</h2>
        {benefitsQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          matches.map(({ benefit, level, reasons }) => {
            const mine = statusOf(benefit.id);
            return (
              <article
                key={benefit.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">{benefitTitle(benefit, lang)}</h3>
                    <p className="text-xs text-muted-foreground">
                      {pickLabel(
                        lang,
                        benefitCategoryLabels[benefit.category]?.th ?? benefit.category,
                        benefitCategoryLabels[benefit.category]?.en ?? benefit.category,
                      )}{" "}
                      · {benefit.provider}
                      {benefit.source_name ? ` · ${benefit.source_name}` : ""}
                      {benefit.verified_at ? ` · ${t.benVerified}: ${benefit.verified_at}` : ""}
                    </p>
                  </div>
                  <Badge className={levelBadge[level].className}>{levelBadge[level].label}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{benefit.summary}</p>
                {reasons.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {localizedReason(lang, reasons[0]!)}
                  </p>
                )}
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-primary">{t.benHowTo}</summary>
                  <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{benefit.how_to}</p>
                  {benefit.deadline_note && (
                    <p className="mt-1 text-xs">
                      <CalendarClock className="mr-1 inline size-3" />
                      {benefit.deadline_note}
                    </p>
                  )}
                </details>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
                  {benefit.link && (
                    <a
                      href={benefit.link}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 inline-flex items-center gap-1 text-xs text-primary underline"
                    >
                      {t.benLink} <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>
    </AppShell>
  );
}

function localizedReason(lang: string, pair: { th: string; en: string }) {
  return lang === "en" ? pair.en : pair.th;
}
