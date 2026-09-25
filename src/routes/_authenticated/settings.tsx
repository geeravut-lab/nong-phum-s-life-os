import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DeleteAccountCard } from "@/components/DeleteAccountCard";
import { LineLinkCard } from "@/components/LineLinkCard";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, type Lang } from "@/lib/i18n";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyPlan,
  listPrivacyAudit,
  startPlanTrial,
  updatePrivacyPrefs,
} from "@/lib/privacy.functions";
import { formatDay } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: routeMeta("settings") }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [dark, setDark] = useState(false);
  const [busy, setBusy] = useState(false);
  const runAudit = useServerFn(listPrivacyAudit);
  const runPlan = useServerFn(getMyPlan);
  const runLoc = useServerFn(updatePrivacyPrefs);
  const runTrial = useServerFn(startPlanTrial);


  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").maybeSingle();
      return data ?? null;
    },
  });

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile?.display_name]);

  const planQ = useQuery({
    queryKey: ["my-plan"],
    queryFn: async () =>
      (await runPlan()) as {
        planTier: string;
        planExpiresAt: string | null;
        shareLocationHelpme: boolean;
      },
  });

  const auditQ = useQuery({
    queryKey: ["privacy-audit"],
    queryFn: async () =>
      (await runAudit()) as {
        logs: Array<{ id: string; action: string; detail: string; created_at: string }>;
      },
  });


  useEffect(() => {
    const stored = window.localStorage.getItem("phum-theme");
    const isDark = stored === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggleTheme = (next: boolean) => {
    setDark(next);
    window.localStorage.setItem("phum-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  };

  const changeLang = async (next: Lang) => {
    setLang(next);
    await supabase.from("profiles").update({ language: next }).eq("id", profile!.id);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", profile!.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.saved);
    qc.invalidateQueries({ queryKey: ["profile"] });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <AppShell>
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">{t.settingsTitle}</h1>
      </header>

      <div className="space-y-4">
        <form
          onSubmit={save}
          className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">{t.displayName}</Label>
            <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <Button type="submit">{t.save}</Button>
        </form>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="mb-3 text-sm font-semibold">{t.language}</h2>
          <div className="flex gap-2">
            <Button
              variant={lang === "th" ? "default" : "outline"}
              size="sm"
              onClick={() => void changeLang("th")}
            >
              {t.thai}
            </Button>
            <Button
              variant={lang === "en" ? "default" : "outline"}
              size="sm"
              onClick={() => void changeLang("en")}
            >
              {t.english}
            </Button>
          </div>
        </section>

        <section className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div>
            <h2 className="text-sm font-semibold">{t.theme}</h2>
            <p className="text-xs text-muted-foreground">{dark ? t.dark : t.light}</p>
          </div>
          <Switch checked={dark} onCheckedChange={toggleTheme} aria-label={t.theme} />
        </section>

        <LineLinkCard />

        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="text-sm font-semibold">{t.privacy}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.privacyText}</p>
        </section>

        <Button variant="outline" onClick={signOut}>
          {t.signOut}
        </Button>

        
      <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="text-sm font-semibold">{t.r5PrivacyCenter}</h2>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm">{t.r5LocationShare}</p>
            <p className="text-xs text-muted-foreground">{t.r5LocationShareHint}</p>
          </div>
          <Switch
            checked={Boolean(planQ.data?.shareLocationHelpme)}
            disabled={busy}
            onCheckedChange={async (v) => {
              setBusy(true);
              try {
                await runLoc({ data: { shareLocationHelpme: v } });
                void qc.invalidateQueries({ queryKey: ["my-plan"] });
                void qc.invalidateQueries({ queryKey: ["privacy-audit"] });
                toast.success(t.saved);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t.error);
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t.r5AuditLog}</p>
          <ul className="max-h-40 space-y-1 overflow-auto text-xs">
            {(auditQ.data?.logs ?? []).length === 0 ? (
              <li className="text-muted-foreground">{t.r5AuditEmpty}</li>
            ) : (
              (auditQ.data?.logs ?? []).map((l) => (
                <li key={l.id} className="flex justify-between gap-2 border-b border-border/50 py-1">
                  <span>
                    {l.action}
                    {l.detail ? ` — ${l.detail}` : ""}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatDay(new Date(l.created_at), lang)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="text-sm font-semibold">{t.r5PlanTitle}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t.r5PlanSkeletonNote}</p>
        <p className="mt-2 text-sm">
          {planQ.data?.planTier === "premium"
            ? t.r5PlanPremium
            : planQ.data?.planTier === "family"
              ? t.r5PlanFamily
              : t.r5PlanFree}
          {planQ.data?.planExpiresAt
            ? ` · ${t.r5PlanExpires} ${formatDay(new Date(planQ.data.planExpiresAt), lang)}`
            : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || planQ.data?.planTier === "premium"}
            onClick={async () => {
              setBusy(true);
              try {
                await runTrial({ data: { planTier: "premium" } });
                toast.success(t.saved);
                void qc.invalidateQueries({ queryKey: ["my-plan"] });
                void qc.invalidateQueries({ queryKey: ["privacy-audit"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t.error);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.r5PlanTrial} ({t.r5PlanPremium})
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || planQ.data?.planTier === "family"}
            onClick={async () => {
              setBusy(true);
              try {
                await runTrial({ data: { planTier: "family" } });
                toast.success(t.saved);
                void qc.invalidateQueries({ queryKey: ["my-plan"] });
                void qc.invalidateQueries({ queryKey: ["privacy-audit"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t.error);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.r5PlanTrial} ({t.r5PlanFamily})
          </Button>
        </div>
      </section>

      <DeleteAccountCard />
      </div>
    </AppShell>
  );
}
