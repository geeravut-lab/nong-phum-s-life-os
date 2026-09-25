import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Bell, ExternalLink, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { catLabel, useI18n } from "@/lib/i18n";
import { analyzeDocument } from "@/lib/lifeos.functions";
import { syncDocumentExpirations } from "@/lib/docs-legacy.functions";
import { DocumentAnalysisError, intakeDocument, retryDocument } from "@/lib/doc-intake";
import { formatMoney } from "@/lib/format";
import { bangkokDateAtHour } from "@/lib/time";
import { daysUntilFailedDocRemoved } from "@/lib/retention";

const MAX_UPLOAD_MB = 10;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const Route = createFileRoute("/_authenticated/docs")({
  head: () => ({ meta: routeMeta("docs") }),
  component: DocsPage,
});

function DocsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeDocument);
  const runSyncExpiry = useServerFn(syncDocumentExpirations);

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      // Receipts attached to expenses/incomes/reminders (kind = 'attachment')
      // live with their rows, not in the vault.
      const { data } = await supabase
        .from("documents")
        .select("*")
        .eq("kind", "analyzed")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const expiringDocs = (docs ?? [])
    .map((d) => {
      const due = d.due_date as string | null;
      const war = (d as { warranty_until?: string | null }).warranty_until ?? null;
      const dates = [due, war].filter(Boolean) as string[];
      if (!dates.length) return null;
      const soonest = dates.sort()[0]!;
      const days =
        (new Date(soonest + "T00:00:00+07:00").getTime() - Date.now()) /
        (86400 * 1000);
      if (days > 60) return null;
      return { ...d, soonest, days };
    })
    .filter(Boolean)
    .sort((a, b) => (a!.soonest > b!.soonest ? 1 : -1)) as Array<{
    id: string;
    title: string;
    soonest: string;
    days: number;
    is_warranty?: boolean;
    category: string;
  }>;

  const { data: family, isError: familyFailed } = useQuery({
    queryKey: ["my-family"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      // Filter by user_id: family_members_read lets a member read every row of
      // their own family (the members list needs that), so an unfiltered
      // maybeSingle() starts failing the moment a second member joins.
      const { data, error } = await supabase
        .from("family_members")
        .select("family_id")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw error;
      return data?.family_id ?? null;
    },
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Base64 inflates by ~33% on the way to the model, and every provider caps
    // request size. Reject here so the user gets a clear message instead of a
    // provider error after a long upload.
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(t.docsFileTooLarge(MAX_UPLOAD_MB));
      return;
    }
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { analysis, routed } = await intakeDocument(file, analyze, lang, userData.user!.id);

      const notes: string[] = [t.savedToDocs];
      if (routed.includes("expense")) notes.push(t.routedToExpense);
      if (routed.includes("income")) notes.push(t.routedToIncome);
      if (routed.includes("reminder")) notes.push(t.routedToTasks);
      toast.success(`${analysis.title} — ${notes.join(" · ")}`);
      qc.invalidateQueries();
    } catch (err) {
      // A failed analysis leaves the row as status="failed"; refresh so it shows up with a retry button.
      if (err instanceof DocumentAnalysisError) qc.invalidateQueries({ queryKey: ["documents"] });
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { analysis, routed } = await retryDocument(id, analyze, lang, userData.user!.id);
      const notes: string[] = [t.savedToDocs];
      if (routed.includes("expense")) notes.push(t.routedToExpense);
      if (routed.includes("income")) notes.push(t.routedToIncome);
      if (routed.includes("reminder")) notes.push(t.routedToTasks);
      toast.success(`${analysis.title} — ${notes.join(" · ")}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.error);
    } finally {
      setRetrying(null);
      qc.invalidateQueries();
    }
  };

  const openFile = async (path: string | null) => {
    if (!path) return;
    const { data } = await supabase.storage.from("documents").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = async (id: string, path: string | null) => {
    if (path) await supabase.storage.from("documents").remove([path]);
    await supabase.from("documents").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["documents"] });
  };

  const makeReminder = async (doc: { id: string; title: string; due_date: string | null }) => {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("reminders").insert({
      user_id: userData.user!.id,
      title: doc.title,
      // A document only knows the day; 09:00 Bangkok is a sensible reminder
      // hour, not the 07:00 that UTC-midnight parsing would produce.
      due_at: doc.due_date ? bangkokDateAtHour(doc.due_date, 9) : null,
      source_document_id: doc.id,
      priority: "high",
    });
    if (error) toast.error(error.message);
    else toast.success(t.saved);
  };

  const toggleShare = async (id: string, next: boolean) => {
    const { error } = await supabase
      .from("documents")
      .update({ is_shared: next, family_id: next ? (family ?? null) : null })
      .eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["documents"] });
  };

  return (
    <AppShell>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t.docsTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.docsSub}</p>
        </div>
        <Button onClick={() => fileInput.current?.click()} disabled={busy}>
          <Upload className="mr-1.5 size-4" />
          {busy ? t.analyzing : t.upload}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={onFile}
        />
      </header>

      {(expiringDocs?.length ?? 0) > 0 && (
        <section className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-medium">{t.r3Expiring}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {expiringDocs.slice(0, 5).map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <span>
                  {d.title}
                  {(d as { is_warranty?: boolean }).is_warranty || d.category === "warranty" ? (
                    <Badge className="ml-1" variant="secondary">
                      {t.r3Warranty}
                    </Badge>
                  ) : null}
                </span>
                <span className="text-muted-foreground">{d.soonest}</span>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="mt-2"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await runSyncExpiry();
                toast.success(`${t.r3SyncDone}: ${res.created}`);
                void qc.invalidateQueries({ queryKey: ["reminders"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t.error);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.r3SyncExpiry}
          </Button>
        </section>
      )}


      {familyFailed && (
        <p className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {t.familyLoadError}
        </p>
      )}

      {busy && <Skeleton className="mb-4 h-28 w-full" />}

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : docs?.length ? (
        <div className="space-y-3">
          {docs.map((d) => (
            <Card key={d.id} className="shadow-soft">
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{d.title}</h2>
                  {d.status === "pending" && <Badge variant="outline">{t.docStatusPending}</Badge>}
                  {d.status === "failed" && <Badge variant="destructive">{t.docStatusFailed}</Badge>}
                  {/* The tick removes failed rows after FAILED_DOC_RETENTION_DAYS; say so before it happens. */}
                  {d.status === "failed" && (
                    <Badge variant="outline">{t.docFailedRemovalIn(daysUntilFailedDocRemoved(d.updated_at))}</Badge>
                  )}
                  {d.status === "ready" && <Badge variant="secondary">{catLabel(d.category, lang)}</Badge>}
                  {d.due_date && (
                    <Badge variant="outline">
                      {t.dueDate}: {d.due_date}
                    </Badge>
                  )}
                  {d.amount != null && (
                    <Badge variant="outline">
                      {formatMoney(Number(d.amount))} {t.baht}
                    </Badge>
                  )}
                </div>
                {d.counterparty && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.counterparty}: {d.counterparty}
                  </p>
                )}
                {d.status === "failed" ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t.docFailedHint}
                    {d.summary && <span className="mt-1 block break-all font-mono text-xs">{d.summary}</span>}
                  </p>
                ) : (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d.summary}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openFile(d.storage_path)}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    {t.download}
                  </Button>
                  {d.status === "failed" && (
                    <Button size="sm" variant="outline" disabled={retrying === d.id} onClick={() => retry(d.id)}>
                      <RefreshCw className={`mr-1.5 size-3.5 ${retrying === d.id ? "animate-spin" : ""}`} />
                      {retrying === d.id ? t.docRetrying : t.docRetry}
                    </Button>
                  )}
                  {d.status === "ready" && (
                    <Button size="sm" variant="outline" onClick={() => makeReminder(d)}>
                      <Bell className="mr-1.5 size-3.5" />
                      {t.createReminderFromDoc}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => remove(d.id, d.storage_path)}
                  >
                    <Trash2 className="mr-1.5 size-3.5" />
                    {t.delete}
                  </Button>
                  {family && (
                    <div className="ml-auto flex items-center gap-2">
                      <Label htmlFor={`sh-${d.id}`} className="text-xs text-muted-foreground">
                        {t.shared}
                      </Label>
                      <Switch
                        id={`sh-${d.id}`}
                        checked={d.is_shared}
                        onCheckedChange={(v) => toggleShare(d.id, v)}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t.docsEmpty}
        </p>
      )}
    </AppShell>
  );
}
