import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { formatDay, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  confirmPremiumPaid,
  createPremiumOrder,
  getBillingPublic,
} from "@/lib/billing.functions";
import { createDonation, DONATION_MAX, DONATION_MIN, getSupportConfig } from "@/lib/support.functions";

// "สนับสนุน" — the user side of the Harmony donation playbook. Order on the
// page: why the button exists → what the money is for (admin-set, never
// hard-coded) → if not set up, a notice instead of a form that would break →
// amount → QR + "I have transferred" → my own donations with their status.

export const Route = createFileRoute("/_authenticated/support")({
  head: () => ({ meta: routeMeta("support") }),
  component: SupportPage,
});

const QUICK_AMOUNTS = [50, 100, 300, 500];

function SupportPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { data: isAdmin } = useIsAdmin();
  const create = useServerFn(createDonation);

  const cfg = useQuery({ queryKey: ["support-config"], queryFn: () => getSupportConfig() });
  const mine = useQuery({
    queryKey: ["my-donations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("donations")
        .select("id, amount_baht, status, ref, created_at, anonymous")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [amountText, setAmountText] = useState("");
  
  const runBilling = useServerFn(getBillingPublic);
  const runOrder = useServerFn(createPremiumOrder);
  const runConfirmPrem = useServerFn(confirmPremiumPaid);
  const [premBusy, setPremBusy] = useState(false);
  const [premRef, setPremRef] = useState("");
  const [premQr, setPremQr] = useState<{
    paymentId: string;
    amount: number;
    qrUrl: string;
  } | null>(null);

  const billingQ = useQuery({
    queryKey: ["billing-public"],
    queryFn: async () =>
      (await runBilling()) as {
        isPremium: boolean;
        settings: {
          premiumMonthly: number;
          premiumYearly: number;
          familyMonthly: number;
          familyYearly: number;
          freeChat: number;
          freeDocument: number;
          freeDecision: number;
          freeTranscribe: number;
          freeTotal: number;
        };
        usage: {
          chat_count: number;
          document_count: number;
          decision_count: number;
          transcribe_count: number;
          total_count: number;
        };
        pricingExplain: {
          freeSummary: string;
          costBasis: string;
          yearlySavePct: number;
          payg: string | null;
        };
      },
  });

  const [chosen, setChosen] = useState<number | null>(null);
  const [ref, setRef] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  const amountNumber = Number(amountText);
  const amountOk = Number.isFinite(amountNumber) && amountNumber >= DONATION_MIN && amountNumber <= DONATION_MAX;

  const submit = useMutation({
    mutationFn: () => create({ data: { amountBaht: Math.round(chosen! * 100) / 100, ref: ref.trim() || undefined, anonymous } }),
    onSuccess: () => {
      toast.success(t.supportReported);
      setChosen(null);
      setAmountText("");
      setRef("");
      qc.invalidateQueries({ queryKey: ["my-donations"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t.error),
  });

  const s = cfg.data;
  const purposeLines = (s?.purpose ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  return (
    <AppShell>
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Heart className="size-5 text-primary" />
          {t.supportTitle}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.supportSub}</p>
      </header>

      <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <p className="text-sm">{t.supportIntro}</p>
        {cfg.isLoading ? (
          <Skeleton className="mt-3 h-12 w-full" />
        ) : purposeLines.length > 0 ? (
          <div className="mt-3 rounded-xl bg-primary/5 p-3">
            <p className="text-xs font-semibold text-primary">{t.supportPurposeLabel}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
              {purposeLines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {cfg.isLoading || !s ? (
        <Skeleton className="h-40 w-full" />
      ) : !s.active ? (
        // Playbook §2.3: never show an empty form that breaks on tap.
        <section className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t.supportNotEnabled}
          {isAdmin && (
            <>
              {" — "}
              <Link to="/admin/support" className="text-primary underline">
                {t.supportAdminHint}
              </Link>
            </>
          )}
        </section>
      ) : chosen === null ? (
        
      

      <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="text-sm font-semibold">{t.supportChooseAmount}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((a) => (
              <Button key={a} variant="outline" onClick={() => setChosen(a)}>
                ฿{formatMoney(a)}
              </Button>
            ))}
          </div>
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (amountOk) setChosen(amountNumber);
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="donate-amt">{t.supportCustomAmount}</Label>
              {/* placeholder, never value: the user should not have to delete a suggested number (playbook §2.4) */}
              <Input
                id="donate-amt"
                type="number"
                min={DONATION_MIN}
                max={DONATION_MAX}
                step="1"
                inputMode="numeric"
                placeholder="10"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!amountOk}>
              {t.supportNext}
            </Button>
          </form>
        </section>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t.supportScanTitle}</h2>
            <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>
              {t.supportChangeAmount}
            </Button>
          </div>
          <PromptPayQr promptpayId={s.promptpay_id!} amount={chosen} />
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="donate-ref">{t.supportRefLabel}</Label>
              <Input id="donate-ref" value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} placeholder={t.supportRefPlaceholder} />
              <p className="text-xs text-muted-foreground">{t.supportRefHint}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} />
              {t.supportAnonymous}
            </label>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? t.loading : t.supportReportTransfer}
            </Button>
          </form>
        </section>
      )}

      
      {/* Premium / Free quota — below donation amount */}
      <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
        {billingQ.data?.isPremium ? (
          <p className="text-sm font-semibold text-primary">{t.billYouArePremium}</p>
        ) : (
          <>
            <h2 className="text-sm font-semibold">{t.billFreeQuota}</h2>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <li>
                {t.billUsed}: chat {billingQ.data?.usage.chat_count ?? 0}/
                {billingQ.data?.settings.freeChat} · doc{" "}
                {billingQ.data?.usage.document_count ?? 0}/
                {billingQ.data?.settings.freeDocument} · total{" "}
                {billingQ.data?.usage.total_count ?? 0}/
                {billingQ.data?.settings.freeTotal}
              </li>
              <li>{billingQ.data?.pricingExplain.freeSummary}</li>
              {billingQ.data?.pricingExplain.payg ? (
                <li>{billingQ.data.pricingExplain.payg}</li>
              ) : null}
              <li className="text-muted-foreground">{t.billFamilyHint}</li>
            </ul>
            <h2 className="mt-3 text-sm font-semibold">{t.billPremiumTitle}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t.billPremiumSub}</p>
            {billingQ.data?.pricingExplain.payg ? (
              <p className="mt-1 text-xs text-muted-foreground">{t.billPaygUserExplain}</p>
            ) : null}
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["premium", "monthly", billingQ.data?.settings.premiumMonthly ?? 89],
                    ["premium", "yearly", billingQ.data?.settings.premiumYearly ?? 890],
                  ] as const
                ).map(([tier, period, price]) => (
                  <Button
                    key={`${tier}-${period}`}
                    size="sm"
                    variant={period === "yearly" ? "default" : "outline"}
                    disabled={premBusy}
                    onClick={async () => {
                      setPremBusy(true);
                      try {
                        const res = (await runOrder({
                          data: { planTier: tier, period },
                        })) as { paymentId: string; amount: number; qrUrl: string };
                        setPremQr(res);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : t.error);
                      } finally {
                        setPremBusy(false);
                      }
                    }}
                  >
                    {t.billUpgrade} · {period === "yearly" ? t.billYearly : t.billMonthly} · ฿
                    {price}
                    {period === "yearly" && billingQ.data?.pricingExplain.yearlySavePct
                      ? ` (${t.billSave} ${billingQ.data.pricingExplain.yearlySavePct}%)`
                      : ""}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["family", "monthly", billingQ.data?.settings.familyMonthly ?? 149],
                    ["family", "yearly", billingQ.data?.settings.familyYearly ?? 1490],
                  ] as const
                ).map(([tier, period, price]) => (
                  <Button
                    key={`${tier}-${period}`}
                    size="sm"
                    variant="secondary"
                    disabled={premBusy}
                    onClick={async () => {
                      setPremBusy(true);
                      try {
                        const res = (await runOrder({
                          data: { planTier: tier, period },
                        })) as { paymentId: string; amount: number; qrUrl: string };
                        setPremQr(res);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : t.error);
                      } finally {
                        setPremBusy(false);
                      }
                    }}
                  >
                    {t.billFamily} · {period === "yearly" ? t.billYearly : t.billMonthly} · ฿
                    {price}
                  </Button>
                ))}
              </div>
            </div>
            {premQr ? (
              <div className="mt-4 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-center">
                <p className="text-xs font-medium">
                  {t.billPayQr} · ฿{premQr.amount.toLocaleString()}
                </p>
                <img
                  src={premQr.qrUrl}
                  alt="PromptPay"
                  className="mx-auto h-48 w-48 rounded-lg bg-white p-2"
                />
                <Button
                  size="sm"
                  disabled={premBusy}
                  onClick={async () => {
                    setPremBusy(true);
                    try {
                      await runConfirmPrem({ data: { paymentId: premQr.paymentId } });
                      toast.success(t.saved);
                      setPremQr(null);
                      void qc.invalidateQueries({ queryKey: ["billing-public"] });
                      void qc.invalidateQueries({ queryKey: ["my-plan"] });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t.error);
                    } finally {
                      setPremBusy(false);
                    }
                  }}
                >
                  {t.billMarkPaid}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>

      
      {/* Premium — below donation amount flow */}
      <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
        {billingQ.data?.isPremium ? (
          <p className="text-sm font-semibold text-primary">{t.billYouArePremium}</p>
        ) : (
          <>
            <h2 className="text-sm font-semibold">{t.billFreeQuota}</h2>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <li>
                {t.billUsed}: {t.billUsedChat} {billingQ.data?.usage.chat_count ?? 0}/
                {billingQ.data?.settings.freeChat} · {t.billUsedDoc}{" "}
                {billingQ.data?.usage.document_count ?? 0}/
                {billingQ.data?.settings.freeDocument} · {t.billUsedTotal}{" "}
                {billingQ.data?.usage.total_count ?? 0}/
                {billingQ.data?.settings.freeTotal}
              </li>
              <li>{billingQ.data?.pricingExplain.freeSummary}</li>
              {!billingQ.data?.isPremium && billingQ.data?.pricingExplain.payg ? (
                <li>{billingQ.data.pricingExplain.payg}</li>
              ) : null}
            </ul>
            <h2 className="mt-3 text-sm font-semibold">{t.billPremiumTitle}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t.billPremiumSub}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.billFamilyHint}</p>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["premium", "monthly", billingQ.data?.settings.premiumMonthly ?? 89],
                    ["premium", "yearly", billingQ.data?.settings.premiumYearly ?? 890],
                  ] as const
                ).map(([tier, period, price]) => (
                  <Button
                    key={`${tier}-${period}`}
                    size="sm"
                    variant={period === "yearly" ? "default" : "outline"}
                    disabled={premBusy}
                    onClick={async () => {
                      setPremBusy(true);
                      try {
                        const res = (await runOrder({
                          data: { planTier: tier, period },
                        })) as { paymentId: string; amount: number; qrUrl: string };
                        setPremQr(res);
                        setPremRef("");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : t.error);
                      } finally {
                        setPremBusy(false);
                      }
                    }}
                  >
                    {t.billUpgrade} · {period === "yearly" ? t.billYearly : t.billMonthly} · ฿{price}
                    {period === "yearly" && billingQ.data?.pricingExplain.yearlySavePct
                      ? ` (${t.billSave} ${billingQ.data.pricingExplain.yearlySavePct}%)`
                      : ""}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["family", "monthly", billingQ.data?.settings.familyMonthly ?? 149],
                    ["family", "yearly", billingQ.data?.settings.familyYearly ?? 1490],
                  ] as const
                ).map(([tier, period, price]) => (
                  <Button
                    key={`${tier}-${period}`}
                    size="sm"
                    variant={period === "yearly" ? "default" : "outline"}
                    disabled={premBusy}
                    onClick={async () => {
                      setPremBusy(true);
                      try {
                        const res = (await runOrder({
                          data: { planTier: tier, period },
                        })) as { paymentId: string; amount: number; qrUrl: string };
                        setPremQr(res);
                        setPremRef("");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : t.error);
                      } finally {
                        setPremBusy(false);
                      }
                    }}
                  >
                    {t.billFamily} · {period === "yearly" ? t.billYearly : t.billMonthly} · ฿{price}
                    {period === "yearly" && billingQ.data?.settings
                      ? ` (${t.billSave} ${Math.round(
                          (1 -
                            (billingQ.data.settings.familyYearly || 1490) /
                              ((billingQ.data.settings.familyMonthly || 149) * 12)) *
                            100,
                        )}%)`
                      : ""}
                  </Button>
                ))}
              </div>
            </div>
            {premQr ? (
              <div className="mt-4 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-center">
                <p className="text-xs font-medium">
                  {t.billPayQr} · ฿{premQr.amount.toLocaleString()}
                </p>
                <img
                  src={premQr.qrUrl}
                  alt="PromptPay"
                  className="mx-auto h-48 w-48 rounded-lg bg-white p-2"
                />
                <div className="space-y-1.5 text-left">
                  <Label htmlFor="prem-ref">{t.billRefLabel}</Label>
                  <Input
                    id="prem-ref"
                    value={premRef}
                    maxLength={40}
                    onChange={(e) => setPremRef(e.target.value)}
                    placeholder={t.billRefPlaceholder}
                  />
                  <p className="text-xs text-muted-foreground">{t.billRefHint}</p>
                </div>
                <Button
                  size="sm"
                  disabled={premBusy}
                  onClick={async () => {
                    setPremBusy(true);
                    try {
                      await runConfirmPrem({
                        data: {
                          paymentId: premQr.paymentId,
                          payerRef: premRef.trim() || undefined,
                        },
                      });
                      toast.success(t.saved);
                      setPremQr(null);
                      setPremRef("");
                      void qc.invalidateQueries({ queryKey: ["billing-public"] });
                      void qc.invalidateQueries({ queryKey: ["my-plan"] });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t.error);
                    } finally {
                      setPremBusy(false);
                    }
                  }}
                >
                  {t.billMarkPaid}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {mine.data && mine.data.length > 0 && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="text-sm font-semibold">{t.supportMyDonations}</h2>
          <ul className="mt-2 divide-y divide-border">
            {mine.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium">฿{formatMoney(Number(d.amount_baht))}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDay(new Date(d.created_at), lang, true)}
                    {d.ref && ` · ${t.supportRefShort} ${d.ref}`}
                    {d.anonymous && ` · ${t.supportAnonymousShort}`}
                  </p>
                </div>
                <DonationStatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}

export function DonationStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "confirmed") return <Badge variant="secondary">{t.donationConfirmed}</Badge>;
  if (status === "rejected") return <Badge variant="destructive">{t.donationRejected}</Badge>;
  return <Badge variant="outline">{t.donationPending}</Badge>;
}

/**
 * Static PromptPay QR from promptpay.io. Three rules from the playbook: the
 * amount is always two decimals, the id is digits only, and the QR sits on
 * white whatever the theme — bank apps fail to scan dark or transparent
 * backgrounds. The fallback is wired in JS, not an onerror attribute.
 */
function PromptPayQr({ promptpayId, amount }: { promptpayId: string; amount: number }) {
  const { t } = useI18n();
  const img = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  const id = promptpayId.replace(/[^0-9]/g, "");
  const amt = Number(amount).toFixed(2);
  const src = `https://promptpay.io/${encodeURIComponent(id)}/${amt}`;

  useEffect(() => {
    setFailed(false);
    const el = img.current;
    if (!el) return;
    const onError = () => setFailed(true);
    el.addEventListener("error", onError);
    return () => el.removeEventListener("error", onError);
  }, [src]);

  return (
    <div className="mt-3 flex flex-col items-center">
      <div className="rounded-xl p-2.5" style={{ background: "#fff" }}>
        {failed ? (
          <div className="flex size-[210px] flex-col items-center justify-center text-center text-sm" style={{ color: "#111" }}>
            <p>{t.supportQrFailed}</p>
            <p className="mt-1 font-mono text-base font-semibold">{promptpayId}</p>
            <p className="mt-1">
              {t.supportAmount} {amt} {t.baht}
            </p>
          </div>
        ) : (
          <img ref={img} src={src} alt="PromptPay QR" width={210} height={210} />
        )}
      </div>
      <p className="mt-2 text-lg font-semibold">฿{amt}</p>
      <p className="text-xs text-muted-foreground">
        {t.supportPromptPayTo} {promptpayId}
      </p>
    </div>
  );
}
