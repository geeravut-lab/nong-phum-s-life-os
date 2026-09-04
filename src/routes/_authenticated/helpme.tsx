import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import { draftJob, matchHelpers, suggestHelperSkills } from "@/lib/marketplace.functions";

export const Route = createFileRoute("/_authenticated/helpme")({
  head: () => ({
    meta: [
      { title: "ช่วยฉันที | น้องภูมิ" },
      {
        name: "description",
        content: "เล่าปัญหาให้น้องภูมิ แล้วระบบจะแปลงเป็นงานและจับคู่ผู้ช่วยใกล้บ้านให้อัตโนมัติ",
      },
      { property: "og:title", content: "ช่วยฉันที | น้องภูมิ" },
      {
        property: "og:description",
        content: "AI รับเรื่อง เข้าใจงาน หาผู้ช่วยที่เหมาะที่สุด นัดหมาย และติดตามงานให้จบ",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HelpMePage,
});

type Draft = Awaited<ReturnType<typeof draftJob>>;

const STATUS_KEY = {
  open: "statusOpen",
  matched: "statusMatched",
  in_progress: "statusInProgress",
  done: "statusDone",
  cancelled: "statusCancelled",
} as const;

function HelpMePage() {
  const { t } = useI18n();
  return (
    <AppShell>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t.helpTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.helpSub}</p>
      </header>
      <Tabs defaultValue="need">
        <TabsList className="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="need">{t.tabNeedHelp}</TabsTrigger>
          <TabsTrigger value="helper">{t.tabBeHelper}</TabsTrigger>
        </TabsList>
        <TabsContent value="need">
          <RequesterTab />
        </TabsContent>
        <TabsContent value="helper">
          <HelperTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function useSettings() {
  return useQuery({
    queryKey: ["platform-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("platform_settings").select("*").maybeSingle();
      return data;
    },
  });
}

function RequesterTab() {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const runDraft = useServerFn(draftJob);
  const runMatch = useServerFn(matchHelpers);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [matchesFor, setMatchesFor] = useState<string | null>(null);
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof matchHelpers>>>([]);
  const { data: settings } = useSettings();

  const { data: jobs } = useQuery({
    queryKey: ["my-jobs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("jobs")
        .select("*, job_offers(*)")
        .eq("user_id", user?.id ?? "")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const makeDraft = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setDraft(await runDraft({ data: { message: text.trim(), lang } }));
    } catch {
      toast.error(t.error);
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (!draft || !user) return;
    const { error } = await supabase.from("jobs").insert({
      user_id: user.id,
      title: draft.title,
      description: draft.description,
      category: draft.category,
      location_text: draft.locationText,
      scheduled_at: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null,
      budget_min: draft.budgetMin,
      budget_max: draft.budgetMax,
      ai_extract: { neededSkills: draft.neededSkills },
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t.jobPosted);
    setDraft(null);
    setText("");
    qc.invalidateQueries({ queryKey: ["my-jobs"] });
  };

  const findMatches = async (jobId: string) => {
    setMatchesFor(jobId);
    setMatches([]);
    try {
      setMatches(await runMatch({ data: { jobId } }));
    } catch {
      toast.error(t.error);
    }
  };

  const acceptOffer = async (offerId: string, jobId: string, helperId: string, price: number | null) => {
    const rate = Number(settings?.commission_rate ?? 5);
    const fee =
      settings?.revenue_mode === "service_fee"
        ? Number(settings?.service_fee ?? 0)
        : Math.round(((price ?? 0) * rate) / 100);
    await supabase.from("job_offers").update({ status: "accepted" }).eq("id", offerId);
    await supabase
      .from("jobs")
      .update({ status: "matched", assigned_helper_id: helperId, agreed_price: price, platform_fee: fee })
      .eq("id", jobId);
    toast.success(t.accepted);
    qc.invalidateQueries({ queryKey: ["my-jobs"] });
  };

  const setStatus = async (jobId: string, status: string) => {
    await supabase.from("jobs").update({ status }).eq("id", jobId);
    qc.invalidateQueries({ queryKey: ["my-jobs"] });
  };

  const feeLabel =
    settings?.revenue_mode === "service_fee"
      ? `${settings?.service_fee} ${t.baht}`
      : `${settings?.commission_rate ?? 5}%`;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.helpAsk}
          rows={3}
          className="mb-3"
        />
        <Button onClick={makeDraft} disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
          {busy ? t.helpDrafting : t.helpDraftBtn}
        </Button>
      </section>

      {draft && (
        <section className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <h2 className="font-semibold">{t.jobDraft}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>{t.jobTitleLabel}</Label>
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label>{t.jobDesc}</Label>
              <Textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label>{t.jobWhere}</Label>
              <Input
                value={draft.locationText ?? ""}
                onChange={(e) => setDraft({ ...draft, locationText: e.target.value })}
              />
            </div>
            <div>
              <Label>{t.jobWhen}</Label>
              <Input
                type="datetime-local"
                value={draft.scheduledAt ? draft.scheduledAt.slice(0, 16) : ""}
                onChange={(e) => setDraft({ ...draft, scheduledAt: e.target.value || null })}
              />
            </div>
            <div>
              <Label>{t.jobBudget}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={draft.budgetMin ?? ""}
                  onChange={(e) => setDraft({ ...draft, budgetMin: e.target.value ? Number(e.target.value) : null })}
                />
                <span>–</span>
                <Input
                  type="number"
                  value={draft.budgetMax ?? ""}
                  onChange={(e) => setDraft({ ...draft, budgetMax: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
            </div>
          </div>
          {draft.followUpQuestions.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {draft.followUpQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {draft.neededSkills.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={post}>{t.postJob}</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t.cancelBtn}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.feeNote(feeLabel)}</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">{t.myJobs}</h2>
        {(jobs ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t.noJobs}</p>}
        {(jobs ?? []).map((job) => {
          const offers = (job.job_offers ?? []) as Array<{
            id: string;
            helper_id: string;
            message: string | null;
            price: number | null;
            status: string;
          }>;
          return (
            <article key={job.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{job.title}</h3>
                  <p className="text-sm text-muted-foreground">{job.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {job.location_text} {job.scheduled_at ? `· ${new Date(job.scheduled_at).toLocaleString()}` : ""}
                    {job.budget_min ? ` · ${job.budget_min}–${job.budget_max} ${t.baht}` : ""}
                  </p>
                </div>
                <Badge>{t[STATUS_KEY[(job.status as keyof typeof STATUS_KEY) ?? "open"] ?? "statusOpen"]}</Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {job.status === "open" && (
                  <Button size="sm" variant="secondary" onClick={() => findMatches(job.id)}>
                    {t.findMatches}
                  </Button>
                )}
                {job.status === "matched" && (
                  <Button size="sm" onClick={() => setStatus(job.id, "in_progress")}>
                    {t.markInProgress}
                  </Button>
                )}
                {job.status === "in_progress" && (
                  <Button size="sm" onClick={() => setStatus(job.id, "done")}>
                    {t.markComplete}
                  </Button>
                )}
              </div>

              {matchesFor === job.id && (
                <div className="mt-3 space-y-2">
                  {matches.length === 0 && <p className="text-sm text-muted-foreground">{t.matching}</p>}
                  {matches.map((m) => (
                    <div key={m.helperId} className="rounded-xl border border-border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{m.displayName}</span>
                        <Badge variant="secondary">
                          {m.score}% {t.matchScore}
                        </Badge>
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {m.distanceKm != null && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3" />
                            {t.away} {m.distanceKm} km
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Star className="size-3" />
                          {m.rating.toFixed(1)}
                        </span>
                        <span>
                          {m.jobsDone} {t.jobsDone}
                        </span>
                        {m.hourlyRate != null && (
                          <span>
                            {m.hourlyRate} {t.baht}/hr
                          </span>
                        )}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.skills.slice(0, 5).map((s) => (
                          <Badge key={s} variant="outline">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground">{t.offers}</p>
                {offers.length === 0 && <p className="text-sm text-muted-foreground">{t.noOffers}</p>}
                {offers.map((o) => (
                  <div key={o.id} className="mt-2 flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                    <div>
                      <p>{o.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.price} {t.baht}
                      </p>
                    </div>
                    {o.status === "pending" && job.status === "open" ? (
                      <Button size="sm" onClick={() => acceptOffer(o.id, job.id, o.helper_id, o.price)}>
                        {t.acceptOffer}
                      </Button>
                    ) : (
                      <Badge variant="secondary">{o.status}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function HelperTab() {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const runSkills = useServerFn(suggestHelperSkills);

  const [intro, setIntro] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{
    display_name: string;
    bio: string;
    skills: string;
    area: string;
    hourly_rate: string;
    available_from: string;
    available_to: string;
    is_active: boolean;
  } | null>(null);
  const [offerFor, setOfferFor] = useState<string | null>(null);
  const [offerPrice, setOfferPrice] = useState("");
  const [offerMsg, setOfferMsg] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["helper-profile"],
    queryFn: async () => {
      const { data } = await supabase
        .from("helper_profiles")
        .select("*")
        .eq("user_id", user?.id ?? "")
        .maybeSingle();
      if (data && !form) {
        setForm({
          display_name: data.display_name,
          bio: data.bio ?? "",
          skills: (data.skills ?? []).join(", "),
          area: data.area ?? "",
          hourly_rate: data.hourly_rate ? String(data.hourly_rate) : "",
          available_from: data.available_from ?? "",
          available_to: data.available_to ?? "",
          is_active: data.is_active,
        });
      }
      return data;
    },
    enabled: !!user,
  });

  const { data: openJobs } = useQuery({
    queryKey: ["open-jobs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("jobs")
        .select("*")
        .eq("status", "open")
        .neq("user_id", user?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
    enabled: !!user,
  });

  const current = form ?? {
    display_name: "",
    bio: "",
    skills: "",
    area: "",
    hourly_rate: "",
    available_from: "",
    available_to: "",
    is_active: true,
  };

  const buildSkills = async () => {
    if (!intro.trim()) return;
    setBusy(true);
    try {
      const res = await runSkills({ data: { text: intro.trim(), lang } });
      setForm({ ...current, skills: res.skills.join(", "), bio: res.bio });
    } catch {
      toast.error(t.error);
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    const payload = {
      user_id: user.id,
      display_name: current.display_name || (user.email ?? "helper"),
      bio: current.bio || null,
      skills: current.skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      area: current.area || null,
      hourly_rate: current.hourly_rate ? Number(current.hourly_rate) : null,
      available_from: current.available_from || null,
      available_to: current.available_to || null,
      is_active: current.is_active,
    };
    const { error } = await supabase.from("helper_profiles").upsert(payload, { onConflict: "user_id" });
    if (error) { toast.error(error.message); return; }
    toast.success(t.saved);
    qc.invalidateQueries({ queryKey: ["helper-profile"] });
  };

  const sendOffer = async (jobId: string) => {
    if (!profile || !user) return;
    const { error } = await supabase.from("job_offers").insert({
      job_id: jobId,
      helper_id: profile.id,
      helper_user_id: user.id,
      price: offerPrice ? Number(offerPrice) : null,
      message: offerMsg || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t.offerSent);
    setOfferFor(null);
    setOfferPrice("");
    setOfferMsg("");
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="font-semibold">{t.helperProfile}</h2>
        <p className="text-sm text-muted-foreground">{t.helperIntro}</p>
        <Textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={2} placeholder={t.helperIntro} />
        <Button variant="secondary" onClick={buildSkills} disabled={busy || !intro.trim()}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
          {t.aiSkills}
        </Button>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{t.helperName}</Label>
            <Input
              value={current.display_name}
              onChange={(e) => setForm({ ...current, display_name: e.target.value })}
            />
          </div>
          <div>
            <Label>{t.helperArea}</Label>
            <Input value={current.area} onChange={(e) => setForm({ ...current, area: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label>{t.helperSkills}</Label>
            <Input value={current.skills} onChange={(e) => setForm({ ...current, skills: e.target.value })} />
          </div>
          <div>
            <Label>{t.helperRate}</Label>
            <Input
              type="number"
              value={current.hourly_rate}
              onChange={(e) => setForm({ ...current, hourly_rate: e.target.value })}
            />
          </div>
          <div>
            <Label>{t.helperAvail}</Label>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={current.available_from}
                onChange={(e) => setForm({ ...current, available_from: e.target.value })}
              />
              <Input
                type="time"
                value={current.available_to}
                onChange={(e) => setForm({ ...current, available_to: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={current.is_active}
              onCheckedChange={(v) => setForm({ ...current, is_active: v })}
              id="helper-active"
            />
            <Label htmlFor="helper-active">{t.helperActive}</Label>
          </div>
        </div>
        <Button onClick={saveProfile}>{t.saveProfile}</Button>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">{t.openJobs}</h2>
        {(openJobs ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t.noOpenJobs}</p>}
        {(openJobs ?? []).map((job) => (
          <article key={job.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h3 className="font-medium">{job.title}</h3>
            <p className="text-sm text-muted-foreground">{job.description}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {job.location_text} {job.scheduled_at ? `· ${new Date(job.scheduled_at).toLocaleString()}` : ""}
              {job.budget_min ? ` · ${job.budget_min}–${job.budget_max} ${t.baht}` : ""}
            </p>
            {offerFor === job.id ? (
              <div className="mt-3 space-y-2">
                <Input
                  type="number"
                  placeholder={t.offerPrice}
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                />
                <Textarea
                  rows={2}
                  placeholder={t.offerMessage}
                  value={offerMsg}
                  onChange={(e) => setOfferMsg(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => sendOffer(job.id)} disabled={!profile}>
                    {t.sendOffer}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOfferFor(null)}>
                    {t.cancelBtn}
                  </Button>
                </div>
              </div>
            ) : (
              <Button className="mt-3" size="sm" variant="secondary" onClick={() => setOfferFor(job.id)}>
                {t.sendOffer}
              </Button>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
