import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { errorText } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import {
  createFuneralPayment,
  getFuneralEvidenceUrl,
  getMyFuneralPlan,
  reportFuneralInstallmentPaid,
  setFuneralFulfilment,
  setFuneralRepresentative,
  startFuneralInstallmentPayment,
} from "@/lib/funeral.functions";

type Plan = {
  id: string;
  status: string;
  admin_status: string;
  admin_notes: string | null;
  fulfilment: string;
  selected_package: string | null;
  total_budget: number | null;
  representative_name: string | null;
  representative_contact: string | null;
};
type Installment = {
  id: string;
  seq: number;
  due_on: string;
  amount: number;
  payment_status: string;
  payer_ref: string | null;
  review_note?: string | null;
};

/**
 * An instalment the payer has reported and an admin has still to check.
 *
 * Two shapes mean the same thing: 'review' once 20260928130000 is pushed, and
 * before that a row left 'due' carrying the reference the payer quoted.
 */
const inReview = (i: Installment) =>
  i.payment_status === "review" || (i.payment_status === "due" && !!i.payer_ref);
type Evidence = {
  id: string;
  kind: string;
  title: string;
  note: string;
  file_path: string | null;
  created_at: string;
};

/**
 * Everything that happens to a funeral plan after the AI has written it.
 *
 * The planner used to end at a QR code, which left the part the spec actually
 * describes - an admin ringing the venue, saying whether it can be done, the
 * user choosing who arranges it, the instalments, the insurance paperwork -
 * with nowhere to live. This is the user's side of that exchange, and it reads
 * the plan back from the server so it survives a reload; the old flow kept the
 * whole thing in local state and lost it.
 */
export function FuneralPlanStatus() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(getMyFuneralPlan);
  const runFulfilment = useServerFn(setFuneralFulfilment);
  const runPay = useServerFn(createFuneralPayment);
  const runStartInstallment = useServerFn(startFuneralInstallmentPayment);
  const runReportInstallment = useServerFn(reportFuneralInstallmentPaid);
  const runSaveRep = useServerFn(setFuneralRepresentative);
  const runEvidenceUrl = useServerFn(getFuneralEvidenceUrl);
  const [busy, setBusy] = useState(false);
  const [installments, setInstallments] = useState<"1" | "12" | "24" | "36">("1");
  // The instalment whose QR is open, and what the payer has typed off the slip.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payQr, setPayQr] = useState<{ amount: number; qrUrl: string | null; seq: number } | null>(
    null,
  );
  const [payerRef, setPayerRef] = useState("");
  const [repOpen, setRepOpen] = useState(false);
  const [rep, setRep] = useState({ name: "", contact: "" });

  const q = useQuery({
    queryKey: ["my-funeral-plan"],
    queryFn: () =>
      load({ data: {} }) as Promise<{
        plan: Plan | null;
        installments: Installment[];
        evidence: Evidence[];
      }>,
  });

  const plan = q.data?.plan ?? null;
  if (!plan || plan.status === "draft") return null;

  const refresh = () => void qc.invalidateQueries({ queryKey: ["my-funeral-plan"] });

  const choose = async (mode: "self" | "platform") => {
    setBusy(true);
    try {
      await runFulfilment({ data: { planId: plan.id, mode } });
      toast.success(t.saved);
      refresh();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!plan.selected_package) return;
    setBusy(true);
    try {
      await runPay({
        data: {
          planId: plan.id,
          packageId: plan.selected_package as "economy" | "standard" | "premium",
          installments: Number(installments) as 1 | 12 | 24 | 36,
        },
      });
      // The schedule below is where paying happens now: each row has its own
      // QR for the amount due and a place to quote the slip.
      refresh();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  /** Open the QR for one instalment - the amount is the one that is due. */
  const openInstallment = async (id: string) => {
    setBusy(true);
    try {
      const res = (await runStartInstallment({ data: { installmentId: id } })) as {
        amount: number;
        qrUrl: string | null;
        seq: number;
      };
      setPayingId(id);
      setPayQr({ amount: res.amount, qrUrl: res.qrUrl, seq: res.seq });
      setPayerRef("");
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  /** "I transferred it" - a claim an admin still has to confirm. */
  const reportInstallment = async () => {
    if (!payingId || !payerRef.trim()) return;
    setBusy(true);
    try {
      await runReportInstallment({
        data: { installmentId: payingId, payerRef: payerRef.trim() },
      });
      toast.success(t.fnReportSent);
      setPayingId(null);
      setPayQr(null);
      setPayerRef("");
      refresh();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const saveRepresentative = async () => {
    setBusy(true);
    try {
      await runSaveRep({
        data: { planId: plan.id, name: rep.name.trim(), contact: rep.contact.trim() },
      });
      toast.success(t.saved);
      setRepOpen(false);
      refresh();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (evidenceId: string) => {
    try {
      const res = (await runEvidenceUrl({ data: { evidenceId } })) as { url: string | null };
      if (res.url) window.open(res.url, "_blank", "noreferrer");
      else toast.error(t.error);
    } catch (e) {
      toast.error(errorText(e, t));
    }
  };

  const kindLabel = (kind: string) =>
    kind === "provider_contact"
      ? t.fnKindProvider
      : kind === "insurance"
        ? t.fnKindInsurance
        : kind === "payment"
          ? t.fnKindPayment
          : t.fnKindOther;

  return (
    <section className="mb-8 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t.fnStatusTitle}</h2>
        <Badge
          variant={
            plan.admin_status === "confirmed"
              ? "secondary"
              : plan.admin_status === "declined"
                ? "destructive"
                : "outline"
          }
        >
          {plan.admin_status === "confirmed"
            ? t.fnStatusConfirmed
            : plan.admin_status === "declined"
              ? t.fnStatusDeclined
              : t.fnStatusReviewing}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        {t.fnPackage}: {plan.selected_package ?? "—"} · {t.fnTotal}: ฿
        {Number(plan.total_budget ?? 0).toLocaleString()}
      </p>

      {plan.admin_notes ? (
        <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">{t.fnAdminNotes}</p>
          <p className="mt-1 whitespace-pre-wrap">{plan.admin_notes}</p>
        </div>
      ) : null}

      {/* Self or platform - only once an admin has confirmed it is possible. */}
      {plan.admin_status === "confirmed" ? (
        plan.fulfilment === "undecided" ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium">{t.fnChooseHow}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void choose("self")}
              >
                {t.fnSelfRun}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void choose("platform")}>
                {t.fnPlatformRun}
              </Button>
            </div>
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-sm">
            {plan.fulfilment === "self" ? t.fnSelfChosen : t.fnPlatformChosen}
          </p>
        )
      ) : null}

      {/* Payment, for a platform-run plan that has not been paid yet. */}
      {plan.fulfilment === "platform" && (q.data?.installments ?? []).length === 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          <Label htmlFor="fn-inst">{t.p6Installments}</Label>
          <select
            id="fn-inst"
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={installments}
            onChange={(e) => setInstallments(e.target.value as typeof installments)}
          >
            <option value="1">{t.p6PayOnce}</option>
            <option value="12">12</option>
            <option value="24">24</option>
            <option value="36">36</option>
          </select>
          <Button size="sm" disabled={busy} onClick={() => void pay()}>
            {t.p6PayAmount}
          </Button>
        </div>
      ) : null}

      {(q.data?.installments ?? []).length > 0 ? (
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-semibold">{t.fnPayPlanTitle}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {(q.data?.installments ?? []).map((i) => (
              <li key={i.id} className="rounded-xl border border-border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {t.fnInstallmentSeq} {i.seq} · ฿{Number(i.amount).toLocaleString()} ·{" "}
                    {t.fnDueOn} {formatDay(new Date(i.due_on), lang)}
                  </span>
                  {i.payment_status === "paid" ? (
                    <Badge variant="secondary">{t.fnPaid}</Badge>
                  ) : inReview(i) ? (
                    <Badge variant="outline">{t.fnAwaitingAdmin}</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void openInstallment(i.id)}
                    >
                      {t.fnReportPaid}
                    </Button>
                  )}
                </div>

                {/* What the payer quoted, so they can see what the admin is
                    checking against - and the admin's answer if it came back. */}
                {i.payer_ref ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.fnPayerRef}: {i.payer_ref}
                  </p>
                ) : null}
                {i.review_note ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.fnAdminNotes}: {i.review_note}
                  </p>
                ) : null}

                {/* Pay this one: the QR carries the amount, and the reference
                    is what lets an admin find the transfer in the statement. */}
                {payingId === i.id && payQr ? (
                  <div className="mt-2 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <p className="text-center text-sm font-medium">
                      {t.p6PayAmount}: ฿{payQr.amount.toLocaleString()}
                    </p>
                    {payQr.qrUrl ? (
                      <img
                        src={payQr.qrUrl}
                        alt="PromptPay"
                        className="mx-auto size-48 rounded-lg bg-white p-2"
                      />
                    ) : (
                      <p className="text-center text-xs text-destructive">{t.fnNoPromptpay}</p>
                    )}
                    <div className="space-y-1">
                      <Label htmlFor={`ref-${i.id}`}>{t.fnPayerRefLabel}</Label>
                      <Input
                        id={`ref-${i.id}`}
                        value={payerRef}
                        maxLength={80}
                        placeholder={t.fnPayerRefPlaceholder}
                        onChange={(e) => setPayerRef(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy || !payerRef.trim()}
                        onClick={() => void reportInstallment()}
                      >
                        {t.fnReportSentBtn}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setPayingId(null);
                          setPayQr(null);
                        }}
                      >
                        {t.cancel}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Who the admin rings, and who the insurer pays. It was collected once
          next to the packages and never shown again, so a wrong number could
          not be spotted let alone corrected. */}
      <div className="border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t.fnRepTitle}</h3>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setRep({
                name: plan.representative_name ?? "",
                contact: plan.representative_contact ?? "",
              });
              setRepOpen((v) => !v);
            }}
          >
            {repOpen ? t.cancel : t.legacyEdit}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t.fnRepUse}</p>
        {repOpen ? (
          <div className="mt-2 space-y-2">
            <div className="space-y-1">
              <Label htmlFor="fn-rep-name-edit">{t.fnRepName}</Label>
              <Input
                id="fn-rep-name-edit"
                value={rep.name}
                onChange={(e) => setRep((r) => ({ ...r, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fn-rep-contact-edit">{t.fnRepContact}</Label>
              <Input
                id="fn-rep-contact-edit"
                value={rep.contact}
                onChange={(e) => setRep((r) => ({ ...r, contact: e.target.value }))}
              />
            </div>
            <Button size="sm" disabled={busy} onClick={() => void saveRepresentative()}>
              {t.save}
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-sm">
            {plan.representative_name || t.fnRepEmpty}
            {plan.representative_contact ? ` · ${plan.representative_contact}` : ""}
          </p>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <h3 className="text-sm font-semibold">{t.fnEvidenceTitle}</h3>
        {(q.data?.evidence ?? []).length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t.fnEvidenceEmpty}</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {(q.data?.evidence ?? []).map((e) => (
              <li key={e.id} className="rounded-xl border border-border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{e.title}</span>
                  <Badge variant="outline" className="text-xs">
                    {kindLabel(e.kind)}
                  </Badge>
                </div>
                {e.note ? <p className="mt-1 text-xs whitespace-pre-wrap">{e.note}</p> : null}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {formatDay(new Date(e.created_at), lang, true)}
                </p>
                {e.file_path ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1"
                    onClick={() => void openFile(e.id)}
                  >
                    {t.fnEvidenceOpen}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Representative fields, shown next to the package list before selecting one. */
export function RepresentativeFields({
  name,
  contact,
  onName,
  onContact,
}: {
  name: string;
  contact: string;
  onName: (v: string) => void;
  onContact: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <Label htmlFor="fn-rep-name">{t.fnRepName}</Label>
        <Input
          id="fn-rep-name"
          className="mt-1"
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="fn-rep-contact">{t.fnRepContact}</Label>
        <Input
          id="fn-rep-contact"
          className="mt-1"
          value={contact}
          onChange={(e) => onContact(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">{t.fnRepHint}</p>
    </div>
  );
}
