import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  adminConfirmPremiumPayment,
  adminRejectPremiumPayment,
} from "@/lib/billing.functions";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { formatDay, formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin_/premium")({
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.rpc("has_role", {
      _user_id: context.user.id,
      _role: "admin",
    });
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
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const runConfirm = useServerFn(adminConfirmPremiumPayment);
  const runReject = useServerFn(adminRejectPremiumPayment);

  const list = useQuery({
    queryKey: ["admin-premium-payments"],
    queryFn: async () => {
      // Only reported transfers (pending) — not draft QR-only orders
      const { data, error } = await supabase
        .from("premium_payments")
        .select("*")
        .eq("payment_status", "pending")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as PremRow[];
    },
    refetchInterval: 15000,
  });

  const history = useQuery({
    queryKey: ["admin-premium-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("premium_payments")
        .select("*")
        .in("payment_status", ["paid", "rejected"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as PremRow[];
    },
  });

  const profiles = useQuery({
    queryKey: ["admin-premium-profiles", list.data?.map((r) => r.user_id).join(",")],
    enabled: !!list.data?.length,
    queryFn: async () => {
      const ids = [...new Set((list.data ?? []).map((r) => r.user_id))];
      if (!ids.length) return {} as Record<string, string>;
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      const map: Record<string, string> = {};
      for (const p of data ?? []) {
        map[p.id] = p.display_name || p.id.slice(0, 8);
      }
      return map;
    },
  });

  const confirm = useMutation({
    mutationFn: async (paymentId: string) => {
      await runConfirm({ data: { paymentId } });
    },
    onSuccess: () => {
      toast.success(t.saved);
      void qc.invalidateQueries({ queryKey: ["admin-premium-payments"] });
      void qc.invalidateQueries({ queryKey: ["admin-premium-history"] });
      void qc.invalidateQueries({ queryKey: ["premium-payments-pending"] });
      void qc.invalidateQueries({ queryKey: ["admin-pending-total"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async (paymentId: string) => {
      await runReject({ data: { paymentId } });
    },
    onSuccess: () => {
      toast.success(t.donationRejected ?? "ปฏิเสธแล้ว");
      void qc.invalidateQueries({ queryKey: ["admin-premium-payments"] });
      void qc.invalidateQueries({ queryKey: ["admin-premium-history"] });
      void qc.invalidateQueries({ queryKey: ["premium-payments-pending"] });
      void qc.invalidateQueries({ queryKey: ["admin-pending-total"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = list.data ?? [];
  const names = profiles.data ?? {};

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
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
          ตรวจ statement ธนาคารก่อนกดยืนยันทุกครั้ง — การกด &quot;ยืนยันรับเงิน&quot; จะเปิดสิทธิ์สมาชิกให้ผู้ใช้
        </div>
        <h2 className="text-sm font-semibold">
          {t.donationPending} ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">ไม่มีรายการรอตรวจสอบ</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold">฿{formatMoney(Number(r.amount))}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      ผู้ใช้: {names[r.user_id] ?? r.user_id.slice(0, 8)}…
                      <span className="ml-1 font-mono text-[10px]">{r.user_id}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      แพ็ก: {r.plan_tier} · {r.period}
                      {r.promptpay_id ? ` · พร้อมเพย์: ${r.promptpay_id}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      อ้างอิง: {r.payer_ref || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      แจ้งเมื่อ: {formatDay(new Date(r.created_at), lang, true)}
                    </p>
                  </div>
                  <Badge variant="outline">{t.donationPending}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reject.isPending || confirm.isPending}
                    onClick={() => reject.mutate(r.id)}
                  >
                    {t.donationNotFound ?? "ไม่พบรายการ"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={confirm.isPending || reject.isPending}
                    onClick={() => confirm.mutate(r.id)}
                  >
                    {t.donationConfirmReceipt ?? "ยืนยันรับเงิน"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(history.data ?? []).length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <h2 className="text-sm font-semibold">ประวัติ</h2>
          <ul className="mt-2 divide-y divide-border text-sm">
            {(history.data ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  ฿{formatMoney(Number(r.amount))} · {r.plan_tier}/{r.period}
                  {r.payer_ref ? ` · ref ${r.payer_ref}` : ""}
                </span>
                <Badge
                  variant={r.payment_status === "paid" ? "secondary" : "outline"}
                >
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
