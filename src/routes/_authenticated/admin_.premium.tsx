import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminConfirmPremiumPayment } from "@/lib/billing.functions";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin_/premium")({
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.rpc("has_role", { _user_id: context.user.id, _role: "admin" });
    if (data !== true) throw redirect({ to: "/today" });
  },
  component: AdminPremiumPage,
});

type PremRow = {
  id: string;
  user_id: string;
  plan_tier: string;
  period: string;
  amount: number;
  payment_status: string;
  payer_ref: string | null;
  promptpay_id: string | null;
  created_at: string;
};

function AdminPremiumPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const runConfirm = useServerFn(adminConfirmPremiumPayment);

  const list = useQuery({
    queryKey: ["admin-premium-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("premium_payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as PremRow[];
    },
    refetchInterval: 15000,
  });

  const confirm = useMutation({
    mutationFn: async (paymentId: string) => {
      await runConfirm({ data: { paymentId } });
    },
    onSuccess: () => {
      toast.success(t.saved);
      void qc.invalidateQueries({ queryKey: ["admin-premium-payments"] });
      void qc.invalidateQueries({ queryKey: ["premium-payments-pending"] });
      void qc.invalidateQueries({ queryKey: ["admin-pending-total"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = (list.data ?? []).filter((r) => r.payment_status === "pending");
  const others = (list.data ?? []).filter((r) => r.payment_status !== "pending");

  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">
          <Link to="/admin" className="underline">
            {t.navAdmin}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.billPremiumPayCard}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.billPremiumPaySub}</p>
      </header>

      <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h2 className="text-sm font-semibold">
          {t.donationPending} ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{"ไม่มีรายการรอตรวจสอบ"}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    ฿{Number(r.amount).toLocaleString()} · {r.plan_tier} · {r.period}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                    {r.payer_ref ? ` · ref ${r.payer_ref}` : ""}
                    <span className="ml-1 font-mono text-[10px]">{r.user_id.slice(0, 8)}…</span>
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate(r.id)}
                >
                  {t.donationConfirmed}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {others.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="text-sm font-semibold">ประวัติ</h2>
          <ul className="mt-2 divide-y divide-border text-sm">
            {others.slice(0, 30).map((r) => (
              <li key={r.id} className="flex justify-between gap-2 py-2">
                <span>
                  ฿{Number(r.amount).toLocaleString()} · {r.plan_tier}/{r.period}
                </span>
                <Badge variant={r.payment_status === "paid" ? "secondary" : "outline"}>
                  {r.payment_status}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
