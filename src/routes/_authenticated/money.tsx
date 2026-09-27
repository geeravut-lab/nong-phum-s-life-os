import { MonthlyBudgetCard } from "@/components/MonthlyBudgetCard";
import { MoneyEditDialog, type EditableMoneyRow } from "@/components/MoneyEditDialog";
import { DateInput, TimeInput } from "@/components/ui/datetime-input";
import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PhumQuickBar } from "@/components/PhumQuickBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AttachmentControl } from "@/components/AttachmentControl";
import { loadLinkedDocs } from "@/lib/attachments";
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
import { formatDay, formatMoney, toDateInput } from "@/lib/format";
import { APP_TIME_ZONE, APP_UTC_OFFSET, bangkokDateTime, bangkokMonthRange } from "@/lib/time";

const hm = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const nowHm = () => hm.format(new Date());

const RANGES = ["this", "last", "all", "custom"] as const;
type RangeKey = (typeof RANGES)[number];

export const Route = createFileRoute("/_authenticated/money")({
  head: () => ({ meta: routeMeta("money") }),
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
  // The form used to ask for a day and quietly stamp "now" as the time, which
  // is right for an entry typed as it happens and wrong for one typed later.
  const [time, setTime] = useState(nowHm());
  const [editing, setEditing] = useState<EditableMoneyRow | null>(null);
  // The summary used to add up every row the account had ever had, which is a
  // number nobody is looking for. This month is what people check.
  const [range, setRange] = useState<RangeKey>("this");
  const [customFrom, setCustomFrom] = useState(() => bangkokMonthRange(0).from);
  const [customTo, setCustomTo] = useState(() => bangkokMonthRange(0).to);

  const period = useMemo(() => {
    if (range === "all") return null;
    if (range === "custom") {
      // Reversed ends are a slip, not an empty range.
      return customFrom <= customTo
        ? { from: customFrom, to: customTo }
        : { from: customTo, to: customFrom };
    }
    return bangkokMonthRange(range === "this" ? 0 : -1);
  }, [range, customFrom, customTo]);

  const inPeriod = useMemo(() => {
    if (!period) return () => true;
    // The date columns are plain YYYY-MM-DD, so a string compare is the
    // comparison - no Date, no zone, nothing to drift.
    return (day: string | null | undefined) => !!day && day >= period.from && day <= period.to;
  }, [period]);

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

  // Receipts / source documents the visible rows point at (1.9).
  const linkedIds = [...(expenses ?? []), ...(incomes ?? [])].map((r) => r.source_document_id);
  const { data: linkedDocs } = useQuery({
    queryKey: ["linked-docs", "money", linkedIds.filter(Boolean).sort()],
    queryFn: () => loadLinkedDocs(linkedIds),
    enabled: !!expenses && !!incomes,
    staleTime: 4 * 60_000, // thumbnails are 5-minute signed URLs
  });

  const shownExpenses = useMemo(
    () => (expenses ?? []).filter((r) => inPeriod((r as { spent_on: string }).spent_on)),
    [expenses, inPeriod],
  );
  const shownIncomes = useMemo(
    () => (incomes ?? []).filter((r) => inPeriod((r as { received_on: string }).received_on)),
    [incomes, inPeriod],
  );

  const rows = useMemo(() => {
    return (tab === "expense" ? shownExpenses : shownIncomes).map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      sourceDocumentId: r.source_document_id,
      amount: Number(r.amount ?? 0),
      date:
        tab === "expense"
          ? (r as { spent_on: string }).spent_on
          : (r as { received_on: string }).received_on,
      // Only rows saved since the app started keeping a time have one. The
      // rest show the day alone rather than a midnight that never happened.
      at:
        tab === "expense"
          ? ((r as { spent_at?: string | null }).spent_at ?? null)
          : ((r as { received_at?: string | null }).received_at ?? null),
    }));
  }, [tab, shownExpenses, shownIncomes]);

  const totals = useMemo(() => {
    const expense = shownExpenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const income = shownIncomes.reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const byCat = new Map<string, number>();
    rows.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount));
    return {
      expense,
      income,
      net: income - expense,
      byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [shownExpenses, shownIncomes, rows]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: userData } = await supabase.auth.getUser();
    const base = {
      user_id: userData.user!.id,
      title,
      amount: Number(amount || 0),
      category,
    };
    // The retry is for the window between this deploying and the migration
    // running: PostgREST refuses the whole insert over one unknown column, and
    // losing the expense is a worse outcome than losing the time of day.
    const insert = (withTime: boolean) =>
      tab === "expense"
        ? supabase.from("expenses").insert({
            ...base,
            spent_on: date,
            ...(withTime ? { spent_at: bangkokDateTime(date, time) } : {}),
          })
        : supabase.from("incomes").insert({
            ...base,
            received_on: date,
            ...(withTime ? { received_at: bangkokDateTime(date, time) } : {}),
          });
    let { error } = await insert(true);
    if (error?.code === "PGRST204" || error?.code === "42703") {
      ({ error } = await insert(false));
    }
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
      <MonthlyBudgetCard />
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

      {/* Which slice of time the numbers below describe. Sits on the summary
          card because the summary is what it changes. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {RANGES.map((r) => (
          <Button
            key={r}
            size="sm"
            variant={range === r ? "default" : "outline"}
            onClick={() => setRange(r)}
          >
            {r === "this"
              ? t.moneyRangeThisMonth
              : r === "last"
                ? t.moneyRangeLastMonth
                : r === "all"
                  ? t.moneyRangeAll
                  : t.moneyRangeCustom}
          </Button>
        ))}
      </div>
      {range === "custom" && (
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="mr-from">{t.moneyRangeFrom}</Label>
            <DateInput
              id="mr-from"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mr-to">{t.moneyRangeTo}</Label>
            <DateInput id="mr-to" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        </div>
      )}

      <Card className="mb-5 shadow-soft">
        <CardContent className="pt-6">
          {period && (
            <p className="mb-3 text-xs text-muted-foreground">
              {formatDay(new Date(`${period.from}T00:00:00${APP_UTC_OFFSET}`), lang)} –{" "}
              {formatDay(new Date(`${period.to}T00:00:00${APP_UTC_OFFSET}`), lang)} ·{" "}
              {t.moneyRangeCount.replace("{n}", String(shownExpenses.length + shownIncomes.length))}
            </p>
          )}
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
                <DateInput id="ex-date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ex-time">{t.atTimeLabel}</Label>
                <TimeInput id="ex-time" value={time} onChange={(e) => setTime(e.target.value)} />
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
                      {catLabel(r.category, lang)} ·{" "}
                      {r.at
                        ? formatDay(new Date(r.at), lang, true)
                        : formatDay(new Date(`${r.date}T00:00:00${APP_UTC_OFFSET}`), lang)}
                    </p>
                    <div className="mt-1.5">
                      <AttachmentControl
                        table={tab === "expense" ? "expenses" : "incomes"}
                        rowId={r.id}
                        doc={(r.sourceDocumentId && linkedDocs?.[r.sourceDocumentId]) || null}
                        onChanged={() => qc.invalidateQueries()}
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <p className="text-sm font-semibold">
                      {formatMoney(r.amount)} {t.baht}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t.edit}
                      title={t.edit}
                      onClick={() =>
                        setEditing({
                          id: r.id,
                          kind: tab === "expense" ? "expense" : "income",
                          title: r.title,
                          amount: r.amount,
                          category: r.category,
                          date: r.date,
                          at: r.at,
                        })
                      }
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </div>
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

      {/* Delete lives inside the editor rather than as a second icon on every
          row: removing money you recorded is not a thing to put one stray tap
          away on a list you scroll. */}
      <MoneyEditDialog
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={() => qc.invalidateQueries()}
      />
    </AppShell>
  );
}
