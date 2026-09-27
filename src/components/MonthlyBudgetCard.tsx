import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import { errorText } from "@/lib/errors";

/**
 * A monthly ceiling the user sets for themselves.
 *
 * It exists so the "spending is over X% of budget" rule has something to be a
 * percentage of - without it the rule could only compare against past months,
 * which answers a different question. Empty means no warning at all: a budget
 * nobody chose is a number to feel bad about, not a useful one.
 */
export function MonthlyBudgetCard() {
  const { t } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["monthly-budget", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("monthly_budget")
        .eq("id", user!.id)
        .maybeSingle();
      return (data?.monthly_budget ?? null) as number | null;
    },
  });

  useEffect(() => {
    if (q.data != null) setValue(String(q.data));
  }, [q.data]);

  const save = async () => {
    setBusy(true);
    try {
      const n = value.trim() === "" ? null : Number(value);
      if (n != null && (!Number.isFinite(n) || n < 0)) throw new Error(t.error);
      const { error } = await supabase
        .from("profiles")
        .update({ monthly_budget: n })
        .eq("id", user!.id);
      if (error) throw error;
      toast.success(t.saved);
      void qc.invalidateQueries({ queryKey: ["monthly-budget", user?.id] });
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
      <Label htmlFor="monthly-budget">{t.budgetTitle}</Label>
      <p className="mt-1 mb-2 text-xs text-muted-foreground">{t.budgetSub}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="monthly-budget"
          type="number"
          min={0}
          inputMode="numeric"
          placeholder={t.budgetPlaceholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {t.save}
        </Button>
      </div>
    </section>
  );
}
