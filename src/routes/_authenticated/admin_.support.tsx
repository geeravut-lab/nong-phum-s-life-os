import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { formatDay, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  getDonationReport,
  isValidPromptPayId,
  settleDonation,
  updateDonationSettings,
} from "@/lib/support.functions";

// Admin side of the donation playbook, three parts on one page: settings
// (PromptPay id / on-off / purpose), the review queue ("ยืนยันรับเงิน" — not
// "อนุมัติ": nothing is being granted), and the revenue report (confirmed
// rows only, loaded once, filtered in memory, CSV with BOM).

export const Route = createFileRoute("/_authenticated/admin_/support")({
  head: () => ({ meta: routeMeta("admin") }),
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.rpc("has_role", { _user_id: context.user.id, _role: "admin" });
    if (data !== true) throw redirect({ to: "/today" });
  },
  component: AdminSupportPage,
});

type Period = "7" | "30" | "90" | "all" | "custom";

function AdminSupportPage() {
  const { t } = useI18n();
  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">
          <Link to="/admin" className="underline">
            {t.adminTitle}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.adminSupportTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.adminSupportSub}</p>
      </header>
      <PendingSection />
      <ReportSection />
      <SettingsSection />
    </AppShell>
  );
}

// ---- 1. review queue -------------------------------------------------------

function PendingSection() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const settle = useServerFn(settleDonation);
  const [target, setTarget] = useState<{
    id: string;
    amount: number;
    status: "confirmed" | "rejected";
  } | null>(null);

  const pending = useQuery({
    queryKey: ["donations-pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("donations")
        .select("id, display_name, email, anonymous, amount_baht, promptpay_id, ref, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const mutation = useMutation({
    mutationFn: (x: { id: string; status: "confirmed" | "rejected" }) => settle({ data: x }),
    onSuccess: (_, x) => {
      toast.success(x.status === "confirmed" ? t.donationConfirmedToast : t.donationRejectedToast);
      setTarget(null);
      qc.invalidateQueries({ queryKey: ["donations-pending"] });
      qc.invalidateQueries({ queryKey: ["donations-report"] });
      qc.invalidateQueries({ queryKey: ["donations-pending-count"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t.error),
  });

  return (
    <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
      <h2 className="text-sm font-semibold">{t.adminDonationsReview}</h2>
      {/* The warning says how to work, not just "be careful". */}
      <p className="mb-3 mt-1 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
        {t.adminDonationsWarning}
      </p>
      {pending.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !pending.data?.length ? (
        <p className="text-sm text-muted-foreground">{t.adminDonationsNone}</p>
      ) : (
        <ul className="space-y-3">
          {pending.data.map((d) => (
            <li key={d.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold">฿{formatMoney(Number(d.amount_baht))}</p>
                <Badge variant="outline">{t.donationPending}</Badge>
              </div>
              <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt className="inline">{t.adminDonationDonor}: </dt>
                  <dd className="inline text-foreground">
                    {d.anonymous
                      ? t.supportAnonymousShort
                      : `${d.display_name ?? "—"}${d.email ? ` · ${d.email}` : ""}`}
                  </dd>
                </div>
                <div>
                  <dt className="inline">{t.supportRefShort}: </dt>
                  <dd className="inline font-mono text-foreground">{d.ref ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline">{t.adminDonationTo}: </dt>
                  <dd className="inline font-mono text-foreground">{d.promptpay_id}</dd>
                </div>
                <div>
                  <dt className="inline">{t.adminDonationReportedAt}: </dt>
                  <dd className="inline text-foreground">
                    {formatDay(new Date(d.created_at), lang, true)}
                  </dd>
                </div>
              </dl>
              {/* Confirm on the right (thumb-side), the destructive choice on the left. */}
              <div className="mt-3 flex justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={() =>
                    setTarget({ id: d.id, amount: Number(d.amount_baht), status: "rejected" })
                  }
                >
                  {t.donationNotFound}
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setTarget({ id: d.id, amount: Number(d.amount_baht), status: "confirmed" })
                  }
                >
                  {t.donationConfirmReceipt}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={!!target}
        onOpenChange={(v) => !mutation.isPending && !v && setTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target?.status === "confirmed"
                ? t.donationConfirmDialog(formatMoney(target.amount))
                : t.donationRejectDialog}
            </AlertDialogTitle>
            <AlertDialogDescription>{t.adminDonationsNoRights}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>{t.cancelBtn}</AlertDialogCancel>
            <AlertDialogAction
              className={
                target?.status === "rejected"
                  ? "bg-destructive text-white hover:bg-destructive/90"
                  : ""
              }
              disabled={mutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (target) mutation.mutate({ id: target.id, status: target.status });
              }}
            >
              {target?.status === "confirmed" ? t.donationConfirmReceipt : t.donationNotFound}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---- 2. revenue report -----------------------------------------------------

function ReportSection() {
  const { t, lang } = useI18n();
  const report = useQuery({
    queryKey: ["donations-report"],
    queryFn: () => getDonationReport(),
    staleTime: 5 * 60_000,
  });
  const [period, setPeriod] = useState<Period>("30");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const rows = useMemo(() => {
    const all = report.data ?? [];
    let since = 0;
    let until = Infinity;
    const now = Date.now();
    if (period === "7" || period === "30" || period === "90")
      since = now - Number(period) * 86_400_000;
    if (period === "custom") {
      if (start) since = new Date(`${start}T00:00:00+07:00`).getTime();
      if (end) until = new Date(`${end}T23:59:59.999+07:00`).getTime();
      // Dates entered the wrong way round: swap rather than show an empty table.
      if (since && until !== Infinity && since > until) [since, until] = [until, since];
    }
    return all.filter((r) => {
      const at = new Date(r.at).getTime();
      return at >= since && at <= until;
    });
  }, [report.data, period, start, end]);

  const total = rows.reduce((s, r) => s + r.amountBaht, 0);
  const donors = new Set(rows.map((r) => r.donorKey)).size;
  const shown = rows.slice(0, 50);

  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      [t.adminColTime, t.adminDonationDonor, t.adminDonationChannel, t.adminDonationAmountBaht],
    ]
      .concat(
        rows.map((r) => [
          formatDay(new Date(r.at), lang, true),
          r.who,
          `PromptPay${r.ref ? ` (${t.supportRefShort} ${r.ref})` : ""}`,
          String(r.amountBaht),
        ]),
      )
      .map((r) => r.map(esc).join(","));
    // BOM: without it Excel mangles Thai.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `donations-${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const periods: Array<[Period, string]> = [
    ["7", t.period7],
    ["30", t.period30],
    ["90", t.period90],
    ["all", t.periodAll],
    ["custom", t.periodCustom],
  ];

  return (
    <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.adminDonationsReport}</h2>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="mr-1.5 size-3.5" />
          CSV
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t.adminDonationsReportNote}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {periods.map(([p, label]) => (
          <Button
            key={p}
            size="sm"
            variant={period === p ? "default" : "outline"}
            onClick={() => setPeriod(p)}
          >
            {label}
          </Button>
        ))}
      </div>
      {period === "custom" && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="rep-start">{t.periodFrom}</Label>
            <Input
              id="rep-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rep-end">{t.periodTo}</Label>
            <Input id="rep-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
      )}
      {report.isLoading ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat
              label={t.adminDonationTotal}
              value={`฿${formatMoney(total)}`}
              sub={t.adminDonationCount(rows.length)}
            />
            <Stat
              label={t.adminDonationAverage}
              value={`฿${formatMoney(rows.length ? total / rows.length : 0)}`}
            />
            <Stat label={t.adminDonationDonors} value={String(donors)} />
          </div>
          {shown.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[10rem]">{t.adminColTime}</TableHead>
                    <TableHead className="min-w-[8rem]">{t.adminDonationDonor}</TableHead>
                    <TableHead className="min-w-[10rem]">{t.adminDonationChannel}</TableHead>
                    <TableHead className="text-right">{t.adminDonationAmountBaht}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDay(new Date(r.at), lang, true)}
                      </TableCell>
                      <TableCell className="text-xs">{r.who}</TableCell>
                      <TableCell className="text-xs">
                        PromptPay{r.ref ? ` (${t.supportRefShort} ${r.ref})` : ""}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium">
                        {formatMoney(r.amountBaht)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > shown.length && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.adminDonationMore(rows.length - shown.length)}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-none">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ---- 3. settings -----------------------------------------------------------

function SettingsSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const save = useServerFn(updateDonationSettings);
  const settings = useQuery({
    queryKey: ["donation-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("donation_settings")
        .select("promptpay_id, enabled, purpose")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return data ?? { promptpay_id: null, enabled: false, purpose: "" };
    },
  });
  const [form, setForm] = useState<{
    promptpayId: string;
    enabled: boolean;
    purpose: string;
  } | null>(null);
  useEffect(() => {
    if (settings.data && form === null) {
      setForm({
        promptpayId: settings.data.promptpay_id ?? "",
        enabled: settings.data.enabled,
        purpose: settings.data.purpose,
      });
    }
  }, [settings.data, form]);

  const mutation = useMutation({
    mutationFn: () => save({ data: form! }),
    onSuccess: () => {
      toast.success(t.adminSaved);
      setForm(null);
      qc.invalidateQueries({ queryKey: ["donation-settings"] });
      qc.invalidateQueries({ queryKey: ["support-config"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t.error),
  });

  const digits = (form?.promptpayId ?? "").replace(/[^0-9]/g, "");
  const idOk = digits === "" || isValidPromptPayId(digits);
  const dirty =
    !!settings.data &&
    !!form &&
    (digits !== (settings.data.promptpay_id ?? "") ||
      form.enabled !== settings.data.enabled ||
      form.purpose !== settings.data.purpose);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <h2 className="text-sm font-semibold">{t.adminDonationSettings}</h2>
      {settings.isLoading || !form ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : (
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pp-id">{t.adminPromptPayId}</Label>
            <Input
              id="pp-id"
              inputMode="numeric"
              value={form.promptpayId}
              onChange={(e) => setForm({ ...form, promptpayId: e.target.value })}
              placeholder="0812345678"
            />
            <p className={`text-xs ${idOk ? "text-muted-foreground" : "text-destructive"}`}>
              {t.adminPromptPayHint}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <div>
              <p className="text-sm font-medium">{t.adminDonationsEnabled}</p>
              <p className="text-xs text-muted-foreground">{t.adminDonationsEnabledHint}</p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-purpose">{t.adminPurposeLabel}</Label>
            <Textarea
              id="pp-purpose"
              rows={4}
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t.adminPurposeHint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={!dirty || !idOk || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {t.adminSave}
            </Button>
            <Button variant="ghost" disabled={!dirty} onClick={() => setForm(null)}>
              {t.adminDiscard}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
