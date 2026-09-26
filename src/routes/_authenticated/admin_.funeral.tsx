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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { errorText } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import {
  addFuneralEvidence,
  adminListFuneralPlans,
  adminReviewFuneralPlan,
  getFuneralEvidenceUrl,
} from "@/lib/funeral.functions";

export const Route = createFileRoute("/_authenticated/admin_/funeral")({
  head: () => ({ meta: routeMeta("admin") }),
  beforeLoad: async ({ context }) => {
    const userId = (context as { user?: { id: string } }).user?.id;
    if (!userId) throw redirect({ to: "/today" });
    const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (data !== true) throw redirect({ to: "/today" });
  },
  component: AdminFuneralPage,
});

type PlanRow = {
  id: string;
  user_id: string | null;
  ownerName: string | null;
  status: string;
  admin_status: string;
  admin_notes: string | null;
  fulfilment: string;
  selected_package: string | null;
  total_budget: number | null;
  representative_name: string | null;
  representative_contact: string | null;
  input: unknown;
  created_at: string;
  installments: Array<{
    id: string;
    seq: number;
    due_on: string;
    amount: number;
    payment_status: string;
  }>;
  evidence: Array<{ id: string; kind: string; title: string; file_path: string | null }>;
};

function AdminFuneralPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(adminListFuneralPlans);
  const runReview = useServerFn(adminReviewFuneralPlan);
  const runAddEvidence = useServerFn(addFuneralEvidence);
  const runEvidenceUrl = useServerFn(getFuneralEvidenceUrl);

  const [filter, setFilter] = useState<"all" | "reviewing" | "confirmed">("reviewing");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<
    Record<
      string,
      {
        kind: "provider_contact" | "insurance" | "payment" | "other";
        title: string;
        note: string;
        file?: { base64: string; mimeType: string; fileName: string };
      }
    >
  >({});

  const q = useQuery({
    queryKey: ["admin-funeral-plans", filter],
    queryFn: () => load({ data: { status: filter } }) as Promise<{ plans: PlanRow[] }>,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-funeral-plans"] });

  const review = async (planId: string, decision: "confirmed" | "declined" | "reviewing") => {
    setBusy(true);
    try {
      await runReview({
        data: { planId, decision, ...(notes[planId] ? { notes: notes[planId] } : {}) },
      });
      toast.success(t.saved);
      refresh();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const submitEvidence = async (planId: string) => {
    const e = evidence[planId];
    if (!e?.title.trim()) return;
    setBusy(true);
    try {
      await runAddEvidence({
        data: {
          planId,
          kind: e.kind,
          title: e.title.trim(),
          note: e.note,
          ...(e.file ? { file: e.file } : {}),
        },
      });
      setEvidence((cur) => ({ ...cur, [planId]: { kind: "other", title: "", note: "" } }));
      toast.success(t.saved);
      refresh();
    } catch (err) {
      toast.error(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (planId: string, file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // FileReader gives "data:<mime>;base64,<payload>"; the server wants the payload.
      const base64 = String(reader.result).split(",")[1] ?? "";
      setEvidence((cur) => ({
        ...cur,
        [planId]: {
          kind: cur[planId]?.kind ?? "other",
          title: cur[planId]?.title ?? "",
          note: cur[planId]?.note ?? "",
          file: { base64, mimeType: file.type || "application/octet-stream", fileName: file.name },
        },
      }));
    };
    reader.readAsDataURL(file);
  };

  const openFile = async (evidenceId: string) => {
    try {
      const res = (await runEvidenceUrl({ data: { evidenceId } })) as { url: string | null };
      if (res.url) window.open(res.url, "_blank", "noreferrer");
    } catch (e) {
      toast.error(errorText(e, t));
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
        <h1 className="text-xl font-semibold tracking-tight">{t.fnAdminTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.fnAdminSub}</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["reviewing", t.fnFilterReviewing],
            ["confirmed", t.fnFilterConfirmed],
            ["all", t.fnFilterAll],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (q.data?.plans ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.fnAdminEmpty}</p>
      ) : (
        <ul className="space-y-4">
          {(q.data?.plans ?? []).map((p) => {
            const ev = evidence[p.id] ?? { kind: "other" as const, title: "", note: "" };
            return (
              <li key={p.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {t.fnOwner}: {p.ownerName ?? p.user_id?.slice(0, 8) ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.fnPackage}: {p.selected_package ?? "—"} · {t.fnTotal}: ฿
                      {Number(p.total_budget ?? 0).toLocaleString()} ·{" "}
                      {formatDay(new Date(p.created_at), lang)}
                    </p>
                    {p.representative_name ? (
                      <p className="text-xs text-muted-foreground">
                        {t.fnRepName}: {p.representative_name}
                        {p.representative_contact ? ` · ${p.representative_contact}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Badge
                      variant={
                        p.admin_status === "confirmed"
                          ? "secondary"
                          : p.admin_status === "declined"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {p.admin_status}
                    </Badge>
                    <Badge variant="outline">{p.fulfilment}</Badge>
                    <Badge variant="outline">{p.status}</Badge>
                  </div>
                </div>

                {/* The AI's answers, so the admin knows what to ask the venue for. */}
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">{t.p6Extras}</summary>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/40 p-2">
                    {JSON.stringify(p.input, null, 2)}
                  </pre>
                </details>

                <div className="mt-3 space-y-1.5">
                  <Label htmlFor={`note-${p.id}`}>{t.fnAdminNotes}</Label>
                  <Textarea
                    id={`note-${p.id}`}
                    rows={2}
                    value={notes[p.id] ?? p.admin_notes ?? ""}
                    onChange={(e) => setNotes((cur) => ({ ...cur, [p.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void review(p.id, "confirmed")}
                    >
                      {t.fnAdminConfirm}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void review(p.id, "declined")}
                    >
                      {t.fnAdminDecline}
                    </Button>
                  </div>
                </div>

                {p.installments.length > 0 ? (
                  <div className="mt-3 border-t border-border pt-2">
                    <h3 className="text-xs font-semibold">{t.fnPayPlanTitle}</h3>
                    <p className="text-xs text-muted-foreground">
                      {p.installments.filter((i) => i.payment_status === "paid").length}/
                      {p.installments.length} {t.fnPaid}
                    </p>
                  </div>
                ) : null}

                <div className="mt-3 space-y-2 border-t border-border pt-2">
                  <h3 className="text-xs font-semibold">{t.fnEvidenceTitle}</h3>
                  {p.evidence.length > 0 ? (
                    <ul className="space-y-1 text-xs">
                      {p.evidence.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-2">
                          <span>
                            {e.title} · {e.kind}
                          </span>
                          {e.file_path ? (
                            <Button size="sm" variant="ghost" onClick={() => void openFile(e.id)}>
                              {t.fnEvidenceOpen}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`kind-${p.id}`}>{t.fnAdminEvidenceKind}</Label>
                      <select
                        id={`kind-${p.id}`}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        value={ev.kind}
                        onChange={(e) =>
                          setEvidence((cur) => ({
                            ...cur,
                            [p.id]: { ...ev, kind: e.target.value as typeof ev.kind },
                          }))
                        }
                      >
                        <option value="provider_contact">{t.fnKindProvider}</option>
                        <option value="insurance">{t.fnKindInsurance}</option>
                        <option value="payment">{t.fnKindPayment}</option>
                        <option value="other">{t.fnKindOther}</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`title-${p.id}`}>{t.fnAdminEvidenceTitle}</Label>
                      <Input
                        id={`title-${p.id}`}
                        className="mt-1"
                        value={ev.title}
                        onChange={(e) =>
                          setEvidence((cur) => ({
                            ...cur,
                            [p.id]: { ...ev, title: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor={`enote-${p.id}`}>{t.fnAdminEvidenceNote}</Label>
                      <Textarea
                        id={`enote-${p.id}`}
                        className="mt-1"
                        rows={2}
                        value={ev.note}
                        onChange={(e) =>
                          setEvidence((cur) => ({
                            ...cur,
                            [p.id]: { ...ev, note: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor={`file-${p.id}`}>{t.fnAdminEvidenceFile}</Label>
                      <Input
                        id={`file-${p.id}`}
                        className="mt-1"
                        type="file"
                        onChange={(e) => pickFile(p.id, e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={busy || !ev.title.trim()}
                    onClick={() => void submitEvidence(p.id)}
                  >
                    {t.fnAdminAddEvidence}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
