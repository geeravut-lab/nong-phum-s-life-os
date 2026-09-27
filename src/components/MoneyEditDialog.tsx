import { DateInput, TimeInput } from "@/components/ui/datetime-input";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { catLabel, categoryLabels, useI18n } from "@/lib/i18n";
import { APP_TIME_ZONE, bangkokDateTime } from "@/lib/time";

export type EditableMoneyRow = {
  id: string;
  kind: "expense" | "income";
  title: string;
  amount: number;
  category: string;
  /** YYYY-MM-DD from the date column. */
  date: string;
  /** The timestamp, when the row has one. */
  at: string | null;
};

const hm = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Edit or delete one money row.
 *
 * The same rule as everywhere else: the date column keeps driving monthly
 * totals, and the timestamp carries the time of day. A row saved before the
 * app kept a time opens with the current one rather than a blank field, so
 * saving never writes a midnight nobody chose.
 */
export function MoneyEditDialog(props: {
  row: EditableMoneyRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!props.row) return null;
  return <Form key={props.row.id} {...props} row={props.row} />;
}

function Form({
  row,
  onClose,
  onSaved,
}: {
  row: EditableMoneyRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const [title, setTitle] = useState(row.title);
  const [amount, setAmount] = useState(String(row.amount));
  const [category, setCategory] = useState(row.category);
  const [date, setDate] = useState(row.date);
  const [time, setTime] = useState(row.at ? hm.format(new Date(row.at)) : hm.format(new Date()));
  const [busy, setBusy] = useState(false);

  const table = row.kind === "expense" ? "expenses" : "incomes";

  const save = async () => {
    setBusy(true);
    try {
      const common = { title: title.trim() || "-", amount: Number(amount || 0), category };
      const stamp = bangkokDateTime(date, time);
      const run = (withTime: boolean) =>
        row.kind === "expense"
          ? supabase
              .from("expenses")
              .update({ ...common, spent_on: date, ...(withTime ? { spent_at: stamp } : {}) })
              .eq("id", row.id)
          : supabase
              .from("incomes")
              .update({ ...common, received_on: date, ...(withTime ? { received_at: stamp } : {}) })
              .eq("id", row.id);
      let { error } = await run(true);
      if (error?.code === "PGRST204" || error?.code === "42703") ({ error } = await run(false));
      if (error) throw error;
      toast.success(t.saved);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t.moneyDeleteConfirm)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from(table).delete().eq("id", row.id);
      if (error) throw error;
      toast.success(t.deleted);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-border bg-card p-4 shadow-soft sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">{t.moneyEditTitle}</h2>
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="me-title">{t.titleLabel}</Label>
            <Input id="me-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="me-amount">{t.amount}</Label>
              <Input
                id="me-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="me-date">{row.kind === "expense" ? t.spentOn : t.receivedOn}</Label>
              <DateInput id="me-date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="me-time">{t.atTimeLabel}</Label>
              <TimeInput id="me-time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" className="text-destructive" disabled={busy} onClick={remove}>
            {t.delete}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={onClose}>
              {t.cancel}
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {t.save}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
