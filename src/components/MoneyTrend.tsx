import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/**
 * Income against spending, month by month.
 *
 * Drawn rather than charted: recharts is in the dependencies but unused, and
 * pulling it in for one small bar pair would cost more bundle than the whole
 * money page. Two divs and a percentage do the same job here.
 *
 * The months come from the rows themselves, so a gap in the data is a gap on
 * the chart rather than a fabricated zero - except inside the span, where a
 * month with nothing in it is a real answer and is drawn empty.
 */
export type TrendRow = { day: string; amount: number };

const MONTHS_SHOWN = 6;

export function MoneyTrend({
  expenses,
  incomes,
  onPickMonth,
}: {
  expenses: TrendRow[];
  incomes: TrendRow[];
  onPickMonth?: (month: string) => void;
}) {
  const { t, lang } = useI18n();

  const months = useMemo(() => {
    const by = new Map<string, { expense: number; income: number }>();
    const add = (rows: TrendRow[], key: "expense" | "income") => {
      for (const r of rows) {
        const m = String(r.day ?? "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(m)) continue;
        const cur = by.get(m) ?? { expense: 0, income: 0 };
        cur[key] += Number(r.amount ?? 0);
        by.set(m, cur);
      }
    };
    add(expenses, "expense");
    add(incomes, "income");
    if (by.size === 0) return [];

    // A continuous run ending at the most recent month with anything in it,
    // so "nothing spent in October" reads as a gap rather than disappearing.
    const keys = [...by.keys()].sort();
    const last = keys[keys.length - 1]!;
    const out: Array<{ key: string; expense: number; income: number }> = [];
    const [ly, lm] = last.split("-").map(Number) as [number, number];
    for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
      const total = ly * 12 + (lm - 1) - i;
      const key = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
      if (key < keys[0]!) continue;
      out.push({ key, ...(by.get(key) ?? { expense: 0, income: 0 }) });
    }
    return out;
  }, [expenses, incomes]);

  if (months.length < 2) return null;

  const peak = Math.max(1, ...months.flatMap((m) => [m.expense, m.income]));

  // Month and year on their own lines, always. Left as one string they wrapped
  // on a phone for whichever months happened to be widest - "เม.ย. 69" in Thai,
  // "Sept 26" in English - and the column that wrapped grew taller than the
  // rest, which pushed its neighbours' bars down. Two fixed lines means every
  // column is the same height whatever the month is called.
  const monthOf = (key: string) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "th-TH-u-ca-buddhist", {
      month: "short",
    }).format(new Date(`${key}-01T00:00:00+07:00`));
  // Asked for the year on its own, Thai adds the era: "พ.ศ. 69". Under a
  // three-letter month that is the widest thing in the column and says nothing
  // the reader does not know, so only the digits are kept.
  const yearOf = (key: string) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "th-TH-u-ca-buddhist", {
      year: "2-digit",
    })
      .format(new Date(`${key}-01T00:00:00+07:00`))
      .replace(/[^\d]/gu, "");
  const label = (key: string) => `${monthOf(key)} ${yearOf(key)}`;

  return (
    <Card className="mb-5 shadow-soft">
      <CardContent className="pt-6">
        <div className="mb-3 flex flex-wrap items-center gap-4">
          <p className="text-sm font-medium">{t.moneyTrendTitle}</p>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-sm bg-emerald-500" />
            {t.totalIncome}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-sm bg-primary" />
            {t.totalExpense}
          </span>
        </div>
        {/* items-stretch, not items-end: every column is the same height, so
            the bars share one baseline no matter how the labels render. */}
        <div className="flex items-stretch justify-between gap-1">
          {months.map((m) => {
            const net = m.income - m.expense;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onPickMonth?.(m.key)}
                className="flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-lg p-0.5 hover:bg-muted"
                title={`${label(m.key)} · ${formatMoney(net)}`}
              >
                <div className="flex h-24 w-full items-end justify-center gap-1">
                  <div
                    className="w-1/3 rounded-t bg-emerald-500"
                    style={{ height: `${Math.round((m.income / peak) * 100)}%` }}
                  />
                  <div
                    className="w-1/3 rounded-t bg-primary"
                    style={{ height: `${Math.round((m.expense / peak) * 100)}%` }}
                  />
                </div>
                <span className="text-center text-[10px] leading-tight text-muted-foreground">
                  <span className="block whitespace-nowrap">{monthOf(m.key)}</span>
                  <span className="block whitespace-nowrap">{yearOf(m.key)}</span>
                </span>
                <span
                  className={`whitespace-nowrap text-[10px] font-medium ${net < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                >
                  {formatMoney(net)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t.moneyTrendHint}</p>
      </CardContent>
    </Card>
  );
}
