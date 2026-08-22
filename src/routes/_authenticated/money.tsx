import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { catLabel, categoryLabels, useI18n } from "@/lib/i18n";
import { formatMoney, toDateInput } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/money")({
  component: MoneyPage,
});

function MoneyPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("other");
  const [spentOn, setSpentOn] = useState(toDateInput(new Date()));

  const { data: expenses } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data } = await supabase
        .from("expenses")
        .select("*")
        .order("spent_on", { ascending: false });
      return data ?? [];
    },
  });

  const summary = useMemo(() => {
    const rows = expenses ?? [];
    const total = rows.reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const byCat = new Map<string, number>();
    rows.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount)));
    return { total, byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]) };
  }, [expenses]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("expenses").insert({
      user_id: userData.user!.id,
      title,
      amount: Number(amount || 0),
      category,
      spent_on: spentOn,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setTitle("");
    setAmount("");
    setOpen(false);
    qc.invalidateQueries();
  };

  return (
    <AppShell>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t.moneyTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.moneySub}</p>
        </div>
        <Button onClick={() => setOpen((v) => !v)}>
          <Plus className="mr-1.5 size-4" />
          {t.addExpense}
        </Button>
      </header>

      <Card className="mb-5 shadow-soft">
        <CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">{t.total}</p>
          <p className="text-2xl font-semibold">
            {formatMoney(summary.total)} <span className="text-sm font-normal">{t.baht}</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {summary.byCat.slice(0, 6).map(([c, v]) => (
              <Badge key={c} variant="secondary">
                {catLabel(c, lang)} · {formatMoney(v)}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {open && (
        <form
          onSubmit={add}
          className="mb-5 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
        >
          <div className="space-y-1.5">
            <Label htmlFor="ex-title">{t.expenseTitle}</Label>
            <Input
              id="ex-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ex-amount">{t.amount}</Label>
              <Input
                id="ex-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t.category}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(categoryLabels).map((c) => (
                    <SelectItem key={c} value={c}>
                      {catLabel(c, lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-date">{t.spentOn}</Label>
              <Input
                id="ex-date"
                type="date"
                value={spentOn}
                onChange={(e) => setSpentOn(e.target.value)}
              />
            </div>
          </div>
          <Button type="submit">{t.add}</Button>
        </form>
      )}

      {expenses?.length ? (
        <ul className="space-y-2">
          {expenses.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{e.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {catLabel(e.category, lang)} · {e.spent_on}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold">
                {formatMoney(Number(e.amount))} {t.baht}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t.moneyEmpty}
        </p>
      )}
    </AppShell>
  );
}
