import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PhumQuickBar } from "@/components/PhumQuickBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  head: () => ({
    meta: [
      { title: "บิลและค่าใช้จ่าย | น้องภูมิ" },
      { name: "description", content: "บันทึกรายรับ-รายจ่าย จัดหมวดอัตโนมัติ และดูสรุปยอดรายเดือน" },
      { property: "og:title", content: "บิลและค่าใช้จ่าย | น้องภูมิ" },
      { property: "og:description", content: "บันทึกรายรับ-รายจ่าย จัดหมวดอัตโนมัติ และดูสรุปยอดรายเดือน" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MoneyPage,
});

function MoneyPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"expense" | "income">("expense");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("other");
  const [date, setDate] = useState(toDateInput(new Date()));

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

  const { data: incomes } = useQuery({
    queryKey: ["incomes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("incomes")
        .select("*")
        .order("received_on", { ascending: false });
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    return (tab === "expense" ? (expenses ?? []) : (incomes ?? [])).map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      amount: Number(r.amount ?? 0),
      date: tab === "expense" ? (r as { spent_on: string }).spent_on : (r as { received_on: string }).received_on,
    }));
  }, [tab, expenses, incomes]);

  const totals = useMemo(() => {
    const expense = (expenses ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const income = (incomes ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const byCat = new Map<string, number>();
    rows.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount));
    return {
      expense,
      income,
      net: income - expense,
      byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [expenses, incomes, rows]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: userData } = await supabase.auth.getUser();
    const base = {
      user_id: userData.user!.id,
      title,
      amount: Number(amount || 0),
      category,
    };
    const { error } =
      tab === "expense"
        ? await supabase.from("expenses").insert({ ...base, spent_on: date })
        : await supabase.from("incomes").insert({ ...base, received_on: date });
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
          {tab === "expense" ? t.addExpense : t.addIncome}
        </Button>
      </header>

      <PhumQuickBar focus={tab === "expense" ? "expenses" : "incomes"} />

      <Card className="mb-5 shadow-soft">
        <CardContent className="pt-6">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{t.totalIncome}</p>
              <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                {formatMoney(totals.income)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.totalExpense}</p>
              <p className="text-lg font-semibold">{formatMoney(totals.expense)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.netBalance}</p>
              <p className="text-lg font-semibold">{formatMoney(totals.net)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {totals.byCat.slice(0, 6).map(([c, v]) => (
              <Badge key={c} variant="secondary">
                {catLabel(c, lang)} · {formatMoney(v)}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "expense" | "income")} className="w-full">
        <TabsList className="mb-4 grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="expense">{t.tabExpense}</TabsTrigger>
          <TabsTrigger value="income">{t.tabIncome}</TabsTrigger>
        </TabsList>

        {open && (
          <form
            onSubmit={add}
            className="mb-5 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
          >
            <div className="space-y-1.5">
              <Label htmlFor="ex-title">{tab === "expense" ? t.expenseTitle : t.incomeTitle}</Label>
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
                <Label htmlFor="ex-date">{tab === "expense" ? t.spentOn : t.receivedOn}</Label>
                <Input
                  id="ex-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit">{t.add}</Button>
          </form>
        )}

        <TabsContent value={tab} className="mt-0">
          {rows.length ? (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {catLabel(r.category, lang)} · {r.date}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold">
                    {formatMoney(r.amount)} {t.baht}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {tab === "expense" ? t.moneyEmpty : t.incomeEmpty}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
