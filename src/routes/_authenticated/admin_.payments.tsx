import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  adminCompletePayout,
  adminConfirmJobPayment,
  listJobPaymentQueues,
} from "@/lib/payment.functions";

export const Route = createFileRoute("/_authenticated/admin_/payments")({
  head: () => ({ meta: routeMeta("admin") }),
  beforeLoad: async ({ context }) => {
    const userId = (context as { user?: { id: string } }).user?.id;
    if (!userId) throw redirect({ to: "/today" });
    const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (data !== true) throw redirect({ to: "/today" });
  },
  component: AdminPaymentsPage,
});

type PayRow = {
  id: string;
  job_id: string;
  amount: number;
  platform_fee: number;
  provider_amount: number;
  payment_status: string;
  payout_status: string | null;
  service_ended: boolean;
  payer_ref: string | null;
  promptpay_id: string | null;
  created_at: string;
  jobs: { title: string; scheduled_at: string | null; status: string } | null;
};

function AdminPaymentsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(listJobPaymentQueues);
  const confirm = useServerFn(adminConfirmJobPayment);
  const payout = useServerFn(adminCompletePayout);

  const queues = useQuery({
    queryKey: ["job-payment-queues"],
    queryFn: () => load(),
  });

  const [dialog, setDialog] = useState<
    | { kind: "held" | "failed"; id: string; amount: number }
    | { kind: "payout"; id: string; amount: number }
    | null
  >(null);

  const settle = useMutation({
    mutationFn: async () => {
      if (!dialog) return;
      if (dialog.kind === "payout") {
        await payout({ data: { paymentId: dialog.id } });
      } else {
        await confirm({ data: { paymentId: dialog.id, action: dialog.kind } });
      }
    },
    onSuccess: () => {
      toast.success(t.payAdminDone);
      setDialog(null);
      qc.invalidateQueries({ queryKey: ["job-payment-queues"] });
      qc.invalidateQueries({ queryKey: ["job-payments-pending-count"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t.error),
  });

  const pending = (queues.data?.pending ?? []) as unknown as PayRow[];
  const held = (queues.data?.held ?? []) as unknown as PayRow[];
  const payoutQ = (queues.data?.payout ?? []) as unknown as PayRow[];
  const refunds = (queues.data?.partialRefunded ?? []) as unknown as PayRow[];

  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">
          <Link to="/admin" className="underline">
            {t.adminTitle}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.payAdminTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.payAdminSub}</p>
      </header>

      <Tabs defaultValue="pending">
        <TabsList className="mb-4 grid w-full grid-cols-4">
          <TabsTrigger value="pending">
            {t.payQueuePending} ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="held">
            {t.payQueueHeld} ({held.length})
          </TabsTrigger>
          <TabsTrigger value="payout">
            {t.payQueuePayout} ({payoutQ.length})
          </TabsTrigger>
          <TabsTrigger value="refund">
            {t.payQueueRefund} ({refunds.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3">
          {queues.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !pending.length ? (
            <p className="text-sm text-muted-foreground">{t.payQueueEmpty}</p>
          ) : (
            pending.map((r) => (
              <PaymentCard key={r.id} row={r} t={t}>
                <Button
                  size="sm"
                  onClick={() => setDialog({ kind: "held", id: r.id, amount: Number(r.amount) })}
                >
                  {t.payConfirmHeld}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ kind: "failed", id: r.id, amount: Number(r.amount) })}
                >
                  {t.payMarkFailed}
                </Button>
              </PaymentCard>
            ))
          )}
        </TabsContent>

        <TabsContent value="held" className="space-y-3">
          {!held.length ? (
            <p className="text-sm text-muted-foreground">{t.payQueueEmpty}</p>
          ) : (
            held.map((r) => <PaymentCard key={r.id} row={r} t={t} />)
          )}
        </TabsContent>

        <TabsContent value="payout" className="space-y-3">
          {!payoutQ.length ? (
            <p className="text-sm text-muted-foreground">{t.payQueueEmpty}</p>
          ) : (
            payoutQ.map((r) => (
              <PaymentCard key={r.id} row={r} t={t}>
                <Button
                  size="sm"
                  onClick={() =>
                    setDialog({ kind: "payout", id: r.id, amount: Number(r.provider_amount) })
                  }
                >
                  {t.payMarkPayoutPaid}
                </Button>
              </PaymentCard>
            ))
          )}
        </TabsContent>

        <TabsContent value="refund" className="space-y-3">
          {!refunds.length ? (
            <p className="text-sm text-muted-foreground">{t.payQueueEmpty}</p>
          ) : (
            refunds.map((r) => <PaymentCard key={r.id} row={r} t={t} />)
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.payAdminConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === "held" && t.payConfirmHeldDialog(formatMoney(dialog.amount))}
              {dialog?.kind === "failed" && t.payMarkFailedDialog(formatMoney(dialog.amount))}
              {dialog?.kind === "payout" && t.payMarkPayoutDialog(formatMoney(dialog.amount))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancelBtn}</AlertDialogCancel>
            <AlertDialogAction onClick={() => settle.mutate()} disabled={settle.isPending}>
              {t.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function PaymentCard({
  row,
  t,
  children,
}: {
  row: PayRow;
  t: ReturnType<typeof useI18n>["t"];
  children?: React.ReactNode;
}) {
  const title = row.jobs?.title ?? row.job_id.slice(0, 8);
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-lg font-semibold">฿{formatMoney(Number(row.amount))}</p>
          <p className="text-xs text-muted-foreground">
            {t.payProviderShare}: ฿{formatMoney(Number(row.provider_amount))} · {t.payPlatformFee}:
            ฿{formatMoney(Number(row.platform_fee))}
          </p>
          {row.payer_ref && (
            <p className="mt-1 text-xs">
              {t.payRef}: <span className="font-mono">{row.payer_ref}</span>
            </p>
          )}
          {row.service_ended && (
            <Badge variant="secondary" className="mt-1">
              {t.payServiceEnded}
            </Badge>
          )}
        </div>
        <Badge variant="outline">{row.payment_status}</Badge>
      </div>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </article>
  );
}
