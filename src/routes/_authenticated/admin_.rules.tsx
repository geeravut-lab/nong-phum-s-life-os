import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { errorText } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { listAutomationRules, updateAutomationRule } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin_/rules")({
  head: () => ({ meta: routeMeta("admin") }),
  beforeLoad: async ({ context }) => {
    const userId = (context as { user?: { id: string } }).user?.id;
    if (!userId) throw redirect({ to: "/today" });
    const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (data !== true) throw redirect({ to: "/today" });
  },
  component: AdminRulesPage,
});

type Rule = {
  key: string;
  title: string;
  description: string;
  enabled: boolean;
  params: Record<string, number> | null;
  last_run_at: string | null;
  last_count: number | null;
};

/** What each parameter means, so the admin is not editing an unlabelled number. */
const PARAM_LABEL: Record<string, { th: string; en: string }> = {
  days: { th: "จำนวนวัน", en: "days" },
  hours: { th: "จำนวนชั่วโมง", en: "hours" },
  percent: { th: "เปอร์เซ็นต์", en: "percent" },
  multiplier: { th: "กี่เท่าของรอบ", en: "× interval" },
  minScore: { th: "คะแนนขั้นต่ำ", en: "min score" },
};

function AdminRulesPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(listAutomationRules);
  const save = useServerFn(updateAutomationRule);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["automation-rules"],
    queryFn: () => load() as Promise<{ rules: Rule[] }>,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["automation-rules"] });

  const toggle = async (key: string, enabled: boolean) => {
    setBusy(true);
    try {
      await save({ data: { key, enabled } });
      toast.success(t.saved);
      refresh();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const saveParams = async (rule: Rule) => {
    const edits = draft[rule.key] ?? {};
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(edits)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) params[k] = n;
    }
    if (Object.keys(params).length === 0) return;
    setBusy(true);
    try {
      await save({ data: { key: rule.key, params } });
      toast.success(t.saved);
      setDraft((cur) => ({ ...cur, [rule.key]: {} }));
      refresh();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">
          <Link to="/admin" className="underline">
            {t.adminTitle}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.rulesTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.rulesSub}</p>
      </header>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <ul className="space-y-3">
          {(q.data?.rules ?? []).map((r) => {
            const params = (r.params ?? {}) as Record<string, number>;
            const keys = Object.keys(params);
            return (
              <li key={r.key} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{r.title}</p>
                    {r.description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                    ) : null}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      <code>{r.key}</code>
                      {r.last_run_at
                        ? ` · ${t.rulesLastRun} ${formatDay(new Date(r.last_run_at), lang, true)}`
                        : ` · ${t.rulesNeverRun}`}
                      {r.last_count != null && r.last_count >= 0
                        ? ` · ${t.rulesLastCount} ${r.last_count}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!r.enabled ? <Badge variant="outline">{t.rulesOff}</Badge> : null}
                    <Switch
                      checked={r.enabled}
                      disabled={busy}
                      onCheckedChange={(v) => void toggle(r.key, v === true)}
                    />
                  </div>
                </div>

                {keys.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border pt-2">
                    {keys.map((k) => (
                      <label key={k} className="text-xs text-muted-foreground">
                        {lang === "en" ? (PARAM_LABEL[k]?.en ?? k) : (PARAM_LABEL[k]?.th ?? k)}
                        <Input
                          className="mt-1 w-28"
                          type="number"
                          min={0}
                          value={draft[r.key]?.[k] ?? String(params[k] ?? "")}
                          onChange={(e) =>
                            setDraft((cur) => ({
                              ...cur,
                              [r.key]: { ...(cur[r.key] ?? {}), [k]: e.target.value },
                            }))
                          }
                        />
                      </label>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void saveParams(r)}
                    >
                      {t.save}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
