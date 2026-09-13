import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { getAiConfig, listAiEvents, testAiModel, updateAiSettings } from "@/lib/admin.functions";
import type { ModelOverrides, ProviderId, TaskKind } from "@/lib/ai-provider.server";
import { formatDay } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

// Client-side guard: a non-admin is sent to /today before the page renders.
// This is convenience, not security — every server function this page calls
// runs requireAdmin, and the tables enforce has_role in RLS.
export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "ผู้ดูแลระบบ | น้องภูมิ" }] }),
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.rpc("has_role", { _user_id: context.user.id, _role: "admin" });
    if (data !== true) throw redirect({ to: "/today" });
  },
  component: AdminPage,
});

const TASKS: TaskKind[] = ["chat", "document", "reasoning"];
const PROVIDERS: ProviderId[] = ["anthropic", "openai", "google"];
const PROVIDER_LABEL: Record<ProviderId, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };
// Sentinel values for the Select components, which cannot carry null/"".
const USE_ENV = "__env__";
const OFF = "none";
const DEFAULT_MODEL = "__default__";

type Draft = {
  default_provider: ProviderId | null;
  fallback_provider: ProviderId | "none" | null;
  model_overrides: ModelOverrides;
};

type TestResult = { ok: boolean; ms: number; text: string };

function AdminPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const runTest = useServerFn(testAiModel);
  const save = useServerFn(updateAiSettings);

  const config = useQuery({ queryKey: ["ai-config"], queryFn: () => getAiConfig() });
  const events = useQuery({ queryKey: ["ai-events"], queryFn: () => listAiEvents() });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | "running">>({});

  // Seed the form from the server once, and again after a save resets it.
  useEffect(() => {
    if (config.data && draft === null) {
      const s = config.data.settings;
      setDraft({
        default_provider: (s?.default_provider as ProviderId | null) ?? null,
        fallback_provider: (s?.fallback_provider as ProviderId | "none" | null) ?? null,
        model_overrides: s?.model_overrides ?? {},
      });
    }
  }, [config.data, draft]);

  const dirty = useMemo(() => {
    if (!config.data || !draft) return false;
    const s = config.data.settings;
    return (
      (s?.default_provider ?? null) !== draft.default_provider ||
      (s?.fallback_provider ?? null) !== draft.fallback_provider ||
      JSON.stringify(s?.model_overrides ?? {}) !== JSON.stringify(draft.model_overrides)
    );
  }, [config.data, draft]);

  const saveMutation = useMutation({
    mutationFn: (d: Draft) => save({ data: d }),
    onSuccess: () => {
      toast.success(`${t.adminSaved} · ${t.adminApplyNote}`);
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["ai-config"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t.error),
  });

  const taskLabel = (task: TaskKind) =>
    task === "chat" ? t.adminTaskChat : task === "document" ? t.adminTaskDocument : t.adminTaskReasoning;

  const setOverride = (provider: ProviderId, task: TaskKind, value: string) => {
    setDraft((d) => {
      if (!d) return d;
      const next: ModelOverrides = { ...d.model_overrides, [provider]: { ...(d.model_overrides[provider] ?? {}) } };
      if (value === DEFAULT_MODEL) delete next[provider]![task];
      else next[provider]![task] = value;
      if (Object.keys(next[provider]!).length === 0) delete next[provider];
      return { ...d, model_overrides: next };
    });
  };

  const test = async (provider: ProviderId, task: TaskKind, modelId: string) => {
    const key = `${provider}:${task}`;
    setTests((s) => ({ ...s, [key]: "running" }));
    try {
      const r = await runTest({ data: { provider, task, modelId } });
      setTests((s) => ({ ...s, [key]: { ok: r.ok, ms: r.ms, text: r.ok ? r.reply : r.error } }));
    } catch (err) {
      setTests((s) => ({ ...s, [key]: { ok: false, ms: 0, text: err instanceof Error ? err.message : String(err) } }));
    }
  };

  if (config.isLoading || !draft) {
    return (
      <AppShell>
        <Skeleton className="h-40 w-full" />
      </AppShell>
    );
  }
  if (config.isError || !config.data) {
    return (
      <AppShell>
        <p className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {config.error instanceof Error ? config.error.message : t.adminForbidden}
        </p>
      </AppShell>
    );
  }

  const cfg = config.data;
  const withKey = cfg.providers.filter((p) => p.hasKey);
  const providerRow = (id: ProviderId) => cfg.providers.find((p) => p.id === id)!;

  return (
    <AppShell>
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">{t.adminTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.adminSub}</p>
      </header>

      {/* ---- In effect now ---- */}
      <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="mb-3 text-sm font-semibold">{t.adminNow}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t.adminNowProvider}</dt>
            <dd className="mt-0.5 font-medium">
              {PROVIDER_LABEL[cfg.effective.provider]}
              {!cfg.settings?.default_provider && (
                <span className="ml-1 text-xs text-muted-foreground">({t.adminUseEnv})</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.adminNowModels}</dt>
            <dd className="mt-0.5 space-y-0.5 font-mono text-xs">
              {TASKS.map((task) => (
                <div key={task}>
                  <span className="text-muted-foreground">{taskLabel(task)}:</span> {cfg.effective.models[task]}
                </div>
              ))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.adminLastEdited}</dt>
            <dd className="mt-0.5">
              {cfg.settings?.updated_by ? (
                <>
                  {formatDay(new Date(cfg.settings.updated_at), lang, true)}
                  <span className="text-muted-foreground"> {t.adminBy} </span>
                  {cfg.updatedByLabel}
                </>
              ) : (
                <span className="text-muted-foreground">{t.adminNever}</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* ---- Providers ---- */}
      <section className="mb-5 grid gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t.adminDefaultProvider}</Label>
          <Select
            value={draft.default_provider ?? USE_ENV}
            onValueChange={(v) => setDraft({ ...draft, default_provider: v === USE_ENV ? null : (v as ProviderId) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={USE_ENV}>
                {t.adminUseEnv}
                {cfg.env.AI_PROVIDER ? ` (${PROVIDER_LABEL[cfg.env.AI_PROVIDER as ProviderId] ?? cfg.env.AI_PROVIDER})` : ""}
              </SelectItem>
              {PROVIDERS.map((id) => (
                <SelectItem key={id} value={id} disabled={!providerRow(id).hasKey}>
                  {PROVIDER_LABEL[id]}
                  {!providerRow(id).hasKey ? ` — ${t.adminNoKey} (${providerRow(id).envKey})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t.adminFallbackProvider}</Label>
          <Select
            value={draft.fallback_provider ?? USE_ENV}
            onValueChange={(v) =>
              setDraft({ ...draft, fallback_provider: v === USE_ENV ? null : (v as ProviderId | "none") })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={USE_ENV}>
                {t.adminUseEnv}
                {cfg.env.AI_FALLBACK_PROVIDER ? ` (${PROVIDER_LABEL[cfg.env.AI_FALLBACK_PROVIDER as ProviderId] ?? cfg.env.AI_FALLBACK_PROVIDER})` : ""}
              </SelectItem>
              <SelectItem value={OFF}>{t.adminFallbackOff}</SelectItem>
              {PROVIDERS.map((id) => (
                <SelectItem key={id} value={id} disabled={!providerRow(id).hasKey}>
                  {PROVIDER_LABEL[id]}
                  {!providerRow(id).hasKey ? ` — ${t.adminNoKey} (${providerRow(id).envKey})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* ---- Models per task ---- */}
      <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="text-sm font-semibold">{t.adminModelsTitle}</h2>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">{t.adminModelsSub}</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.adminColProvider}</TableHead>
                {TASKS.map((task) => (
                  <TableHead key={task}>{taskLabel(task)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {withKey.map((p) => {
                const list = cfg.models[p.id];
                return (
                  <TableRow key={p.id}>
                    <TableCell className="align-top">
                      <div className="font-medium">{PROVIDER_LABEL[p.id]}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant={list?.source === "live" ? "secondary" : "outline"}>
                          {list?.source === "live" ? t.adminListLive : t.adminListHardcoded}
                        </Badge>
                        {p.capabilities.audio && <Badge variant="outline">audio</Badge>}
                      </div>
                      <p className="mt-1 max-w-[14rem] break-all font-mono text-[10px] text-muted-foreground" title={p.baseUrl}>
                        {new URL(p.baseUrl).host}
                      </p>
                      {list?.error && (
                        <p className="mt-1 max-w-[14rem] text-xs text-destructive" title={list.error}>
                          {t.adminListFailed}
                        </p>
                      )}
                    </TableCell>
                    {TASKS.map((task) => {
                      const override = draft.model_overrides[p.id]?.[task];
                      const effectiveId = override ?? p.defaults[task];
                      const options = list?.models ?? [];
                      const known = options.some((m) => m.id === override);
                      const key = `${p.id}:${task}`;
                      const result = tests[key];
                      return (
                        <TableCell key={task} className="min-w-[14rem] align-top">
                          <Select
                            value={override ?? DEFAULT_MODEL}
                            onValueChange={(v) => setOverride(p.id, task, v)}
                          >
                            <SelectTrigger className="font-mono text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={DEFAULT_MODEL}>
                                {t.adminDefaultModel} · {p.defaults[task]}
                              </SelectItem>
                              {override && !known && <SelectItem value={override}>{override}</SelectItem>}
                              {options.map((m) => (
                                <SelectItem key={m.id} value={m.id} className="font-mono text-xs">
                                  {m.id}
                                  {task === "document" && m.imageInput === false ? " ✕img" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="mt-1.5 flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={result === "running"}
                              onClick={() => test(p.id, task, effectiveId)}
                            >
                              {result === "running" ? t.adminTesting : t.adminTest}
                            </Button>
                            {result && result !== "running" && (
                              <span className={`text-xs ${result.ok ? "text-primary" : "text-destructive"}`} title={result.text}>
                                {result.ok ? `✅ ${t.adminTestOk}` : `❌ ${t.adminTestFail}`} · {result.ms} ms
                              </span>
                            )}
                          </div>
                          {result && result !== "running" && !result.ok && (
                            <p className="mt-1 max-w-[16rem] break-words font-mono text-[11px] text-destructive">{result.text}</p>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate(draft)}>
            {t.adminSave}
          </Button>
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(null)}>
            {t.adminDiscard}
          </Button>
          <span className="text-xs text-muted-foreground">{t.adminApplyNote}</span>
        </div>
      </section>

      {/* ---- Events ---- */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="text-sm font-semibold">{t.adminEventsTitle}</h2>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">{t.adminEventsSub}</p>
        {events.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : !events.data?.length ? (
          <p className="text-sm text-muted-foreground">{t.adminEventsEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.adminColTime}</TableHead>
                  <TableHead>{t.adminColProvider}</TableHead>
                  <TableHead>{t.adminColTask}</TableHead>
                  <TableHead>{t.adminColStatus}</TableHead>
                  <TableHead>{t.adminColCode}</TableHead>
                  <TableHead>{t.adminColMessage}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDay(new Date(e.created_at), lang, true)}</TableCell>
                    <TableCell className="text-xs">{e.provider}</TableCell>
                    <TableCell className="text-xs">{e.task}</TableCell>
                    <TableCell>
                      <Badge variant={e.status === "error" ? "destructive" : "secondary"}>{e.status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.error_code ?? "—"}</TableCell>
                    <TableCell className="max-w-[28rem] truncate text-xs" title={e.message ?? ""}>
                      {e.message ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
