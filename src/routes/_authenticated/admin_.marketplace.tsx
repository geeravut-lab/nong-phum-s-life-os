import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { getMarketplaceSettings, updateMarketplaceSettings } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin_/marketplace")({
  head: () => ({ meta: routeMeta("admin") }),
  beforeLoad: async ({ context }) => {
    const userId = (context as { user?: { id: string } }).user?.id;
    if (!userId) throw redirect({ to: "/today" });
    const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (data !== true) throw redirect({ to: "/today" });
  },
  component: AdminMarketplacePage,
});

function AdminMarketplacePage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(getMarketplaceSettings);
  const save = useServerFn(updateMarketplaceSettings);
  const q = useQuery({ queryKey: ["marketplace-settings"], queryFn: () => load() });

  const [mode, setMode] = useState<"commission" | "service_fee">("commission");
  const [rate, setRate] = useState("5");
  const [fee, setFee] = useState("30");
  const [cancelPct, setCancelPct] = useState("20");
  const [escrow, setEscrow] = useState(true);
  const [pp, setPp] = useState("");

  useEffect(() => {
    if (!q.data) return;
    setMode((q.data.revenue_mode as "commission" | "service_fee") || "commission");
    setRate(String(q.data.commission_rate ?? 5));
    setFee(String(q.data.service_fee ?? 30));
    setCancelPct(String(q.data.cancel_fee_pct ?? 20));
    setEscrow(q.data.escrow_enabled !== false);
    setPp(q.data.helpme_promptpay_id ?? "");
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          revenue_mode: mode,
          commission_rate: Number(rate),
          service_fee: Number(fee),
          cancel_fee_pct: Number(cancelPct),
          escrow_enabled: escrow,
          helpme_promptpay_id: pp.trim() ? pp.trim() : null,
        },
      }),
    onSuccess: () => {
      toast.success(t.mktSettingsSaved);
      qc.invalidateQueries({ queryKey: ["marketplace-settings"] });
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t.error),
  });

  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">
          <Link to="/admin" className="underline">
            {t.adminTitle}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.mktAdminTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.mktAdminSub}</p>
      </header>

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <section className="max-w-lg space-y-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div>
            <Label>{t.mktRevenueMode}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "commission" | "service_fee")}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="commission">{t.mktModeCommission}</SelectItem>
                <SelectItem value="service_fee">{t.mktModeServiceFee}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t.mktCommissionRate}</Label>
              <Input
                className="mt-1"
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
            <div>
              <Label>{t.mktServiceFee}</Label>
              <Input
                className="mt-1"
                type="number"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            </div>
            <div>
              <Label>{t.mktCancelFeePct}</Label>
              <Input
                className="mt-1"
                type="number"
                value={cancelPct}
                onChange={(e) => setCancelPct(e.target.value)}
              />
            </div>
            <div>
              <Label>{t.mktPromptPay}</Label>
              <Input
                className="mt-1"
                value={pp}
                onChange={(e) => setPp(e.target.value)}
                placeholder="0xxxxxxxxxx"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={escrow} onCheckedChange={setEscrow} id="escrow" />
            <Label htmlFor="escrow">{t.mktEscrowEnabled}</Label>
          </div>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {t.save}
          </Button>
        </section>
      )}
    </AppShell>
  );
}
