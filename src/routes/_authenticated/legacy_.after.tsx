import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
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
import { confirmDeathCase, reportDeathCase } from "@/lib/death.functions";
import {
  createFuneralPayment,
  markFuneralPaid,
  planFuneral,
} from "@/lib/funeral.functions";

export const Route = createFileRoute("/_authenticated/legacy_/after")({
  head: () => ({ meta: routeMeta("legacy") }),
  component: LegacyAfterPage,
});

function LegacyAfterPage() {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const runReport = useServerFn(reportDeathCase);
  const runConfirm = useServerFn(confirmDeathCase);
  const runPlan = useServerFn(planFuneral);
  const runPay = useServerFn(createFuneralPayment);
  const runMarkPaid = useServerFn(markFuneralPaid);

  const [busy, setBusy] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [confirmNote, setConfirmNote] = useState("");

  // Funeral form
  const [fBudget, setFBudget] = useState("");
  const [fReligion, setFReligion] = useState("พุทธ");
  const [fProvince, setFProvince] = useState("กรุงเทพมหานคร");
  const [fDays, setFDays] = useState("3");
  const [fGuests, setFGuests] = useState("100");
  const [fStyle, setFStyle] = useState("");
  const [fExtras, setFExtras] = useState("");
  const [planResult, setPlanResult] = useState<{
    planId: string;
    packages: Array<{
      id: string;
      name: string;
      totalBudget: number;
      summary: string;
      lineItems: Array<{ item: string; estimate: number }>;
      timeline: string[];
    }>;
    notes: string;
  } | null>(null);
  const [payInfo, setPayInfo] = useState<{
    paymentId: string;
    amount: number;
    qrUrl: string | null;
    installments: number;
  } | null>(null);
  const [installments, setInstallments] = useState<"1" | "12" | "24" | "36">("1");

  const casesQ = useQuery({
    queryKey: ["death-cases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("death_cases")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const memorialsQ = useQuery({
    queryKey: ["my-memorials", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memorials")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const onReport = async () => {
    if (!subjectId.trim()) return;
    setBusy(true);
    try {
      const res = await runReport({
        data: {
          subjectUserId: subjectId.trim(),
          note: reportNote,
          requiredConfirmations: 2,
        },
      });
      toast.success(res.alreadyExists ? t.p6CaseExists : t.p6CaseCreated);
      void qc.invalidateQueries({ queryKey: ["death-cases"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async (caseId: string, decision: "confirm" | "reject") => {
    if (!confirmName.trim()) {
      toast.error(t.p6NeedName);
      return;
    }
    setBusy(true);
    try {
      const res = await runConfirm({
        data: {
          caseId,
          decision,
          confirmerName: confirmName.trim(),
          note: confirmNote,
        },
      });
      toast.success(
        res?.status === "confirmed" ? t.p6CaseConfirmed : t.p6ConfirmRecorded,
      );
      void qc.invalidateQueries({ queryKey: ["death-cases"] });
      void qc.invalidateQueries({ queryKey: ["my-memorials"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const onPlan = async () => {
    setBusy(true);
    try {
      const res = await runPlan({
        data: {
          budget: fBudget ? Number(fBudget) : null,
          religion: fReligion,
          province: fProvince,
          days: fDays ? Number(fDays) : null,
          guests: fGuests ? Number(fGuests) : null,
          style: fStyle,
          extras: fExtras,
          lang: lang === "en" ? "en" : "th",
        },
      });
      setPlanResult(res as typeof planResult);
      toast.success(t.p6PlanReady);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const onSelectPackage = async (packageId: "economy" | "standard" | "premium") => {
    if (!planResult) return;
    setBusy(true);
    try {
      const res = await runPay({
        data: {
          planId: planResult.planId,
          packageId,
          installments: Number(installments) as 1 | 12 | 24 | 36,
        },
      });
      setPayInfo(res);
      toast.success(t.p6PayReady);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const onMarkPaid = async () => {
    if (!payInfo) return;
    setBusy(true);
    try {
      await runMarkPaid({ data: { paymentId: payInfo.paymentId } });
      toast.success(t.p6PaidMarked);
      setPayInfo(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <header className="mb-4">
        <p className="text-xs text-muted-foreground">
          <Link to="/legacy" className="underline">
            {t.legacyTitle}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.p6Title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.p6Sub}</p>
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          {t.p6LegalNote}
        </p>
      </header>

      {/* Death verification */}
      <section className="mb-8 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="font-semibold">{t.p6DeathTitle}</h2>
        <p className="text-xs text-muted-foreground">{t.p6DeathHint}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>{t.p6SubjectUserId}</Label>
            <Input
              className="mt-1 font-mono text-xs"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              placeholder="uuid ของผู้ใช้ในระบบ"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>{t.p6ReportNote}</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={reportNote}
              onChange={(e) => setReportNote(e.target.value)}
            />
          </div>
        </div>
        <Button disabled={busy || !subjectId.trim()} onClick={onReport}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t.p6ReportBtn}
        </Button>

        <div className="border-t border-border pt-3">
          <Label>{t.p6ConfirmName}</Label>
          <Input
            className="mt-1"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
          />
          <Textarea
            className="mt-2"
            rows={2}
            placeholder={t.p6ConfirmNote}
            value={confirmNote}
            onChange={(e) => setConfirmNote(e.target.value)}
          />
        </div>

        <ul className="space-y-2">
          {(casesQ.data ?? []).map((c) => (
            <li key={c.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs">{c.subject_user_id.slice(0, 8)}…</span>
                <Badge
                  variant={
                    c.status === "confirmed"
                      ? "default"
                      : c.status === "rejected"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {c.status} ({c.confirmation_count}/{c.required_confirmations})
                </Badge>
              </div>
              {c.report_note ? (
                <p className="mt-1 text-xs text-muted-foreground">{c.report_note}</p>
              ) : null}
              {c.status === "pending" && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => onConfirm(c.id, "confirm")}>
                    {t.p6Confirm}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onConfirm(c.id, "reject")}
                  >
                    {t.p6Reject}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Memorials */}
      <section className="mb-8 space-y-2">
        <h2 className="font-semibold">{t.p6MemorialTitle}</h2>
        {(memorialsQ.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.p6MemorialEmpty}</p>
        ) : (
          (memorialsQ.data ?? []).map((m) => (
            <article key={m.id} className="rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">{m.title}</p>
              {m.share_token && m.is_public ? (
                <Link
                  to="/memorial/$token"
                  params={{ token: m.share_token }}
                  className="text-xs text-primary underline"
                >
                  {t.p6OpenMemorial}
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">{t.p6MemorialPrivate}</span>
              )}
            </article>
          ))
        )}
      </section>

      {/* Funeral planner */}
      <section className="mb-8 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="font-semibold">{t.p6FuneralTitle}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label>{t.p6Budget}</Label>
            <Input
              className="mt-1"
              type="number"
              value={fBudget}
              onChange={(e) => setFBudget(e.target.value)}
            />
          </div>
          <div>
            <Label>{t.p6Religion}</Label>
            <Input
              className="mt-1"
              value={fReligion}
              onChange={(e) => setFReligion(e.target.value)}
            />
          </div>
          <div>
            <Label>{t.p6Province}</Label>
            <Input
              className="mt-1"
              value={fProvince}
              onChange={(e) => setFProvince(e.target.value)}
            />
          </div>
          <div>
            <Label>{t.p6Days}</Label>
            <Input
              className="mt-1"
              type="number"
              value={fDays}
              onChange={(e) => setFDays(e.target.value)}
            />
          </div>
          <div>
            <Label>{t.p6Guests}</Label>
            <Input
              className="mt-1"
              type="number"
              value={fGuests}
              onChange={(e) => setFGuests(e.target.value)}
            />
          </div>
          <div>
            <Label>{t.p6Style}</Label>
            <Input className="mt-1" value={fStyle} onChange={(e) => setFStyle(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>{t.p6Extras}</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={fExtras}
              onChange={(e) => setFExtras(e.target.value)}
            />
          </div>
        </div>
        <Button disabled={busy} onClick={onPlan}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t.p6PlanBtn}
        </Button>

        {planResult && (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">{planResult.notes}</p>
            <div>
              <Label>{t.p6Installments}</Label>
              <Select
                value={installments}
                onValueChange={(v) => setInstallments(v as typeof installments)}
              >
                <SelectTrigger className="mt-1 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t.p6PayOnce}</SelectItem>
                  <SelectItem value="12">12</SelectItem>
                  <SelectItem value="24">24</SelectItem>
                  <SelectItem value="36">36</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {planResult.packages.map((pkg) => (
              <article key={pkg.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <p className="font-medium">{pkg.name}</p>
                  <span>฿{Number(pkg.totalBudget).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{pkg.summary}</p>
                <ul className="mt-2 list-disc pl-4 text-xs">
                  {pkg.lineItems.slice(0, 6).map((li) => (
                    <li key={li.item}>
                      {li.item}: ฿{Number(li.estimate).toLocaleString()}
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={busy}
                  onClick={() =>
                    onSelectPackage(pkg.id as "economy" | "standard" | "premium")
                  }
                >
                  {t.p6SelectPackage}
                </Button>
              </article>
            ))}
          </div>
        )}

        {payInfo && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <p className="font-medium">
              {t.p6PayAmount}: ฿{payInfo.amount.toLocaleString()}
              {payInfo.installments > 1
                ? ` (${t.p6PerInstallment} × ${payInfo.installments})`
                : ""}
            </p>
            {payInfo.qrUrl ? (
              <img
                src={payInfo.qrUrl}
                alt="PromptPay QR"
                className="mx-auto mt-2 size-48 rounded-lg bg-white p-2"
              />
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{t.p6NoPromptPay}</p>
            )}
            <Button className="mt-2" size="sm" disabled={busy} onClick={onMarkPaid}>
              {t.p6MarkPaid}
            </Button>
          </div>
        )}
      </section>
    </AppShell>
  );
}
