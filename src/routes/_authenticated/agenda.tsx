import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, List, Loader2, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { formatDay } from "@/lib/format";
import {
  aiEditAgendaItem,
  listUnifiedAgenda,
  updateAgendaItem,
  type AgendaItem,
} from "@/lib/agenda.functions";

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({ meta: routeMeta("agenda") }),
  component: AgendaPage,
});

type ViewMode = "list" | "day" | "week" | "month";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Day bucket key in the viewer's own timezone.
 *
 * toISOString() would convert to UTC first, which shifts the date for any
 * zone east of UTC: in Bangkok (UTC+7) a cell built as new Date(y, m, d) is
 * local midnight, i.e. 17:00Z the day before, so its key came out one day
 * early, while an event at 02:00 local fell into the previous day's bucket.
 * Reading the local calendar fields keeps cells and events on the same day.
 */
function localDayKey(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function AgendaPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const runList = useServerFn(listUnifiedAgenda);
  const runUpdate = useServerFn(updateAgendaItem);
  const runAi = useServerFn(aiEditAgendaItem);

  const [view, setView] = useState<ViewMode>("list");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [edit, setEdit] = useState<AgendaItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editWhen, setEditWhen] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [aiText, setAiText] = useState("");
  const [busy, setBusy] = useState(false);

  const range = useMemo(() => {
    if (view === "day") {
      const from = startOfDay(cursor);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (view === "week") {
      const from = startOfDay(cursor);
      const day = from.getDay();
      from.setDate(from.getDate() - ((day + 6) % 7)); // Monday start
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (view === "month") {
      const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    // list: wide window
    const from = new Date(Date.now() - 7 * 864e5);
    const to = new Date(Date.now() + 45 * 864e5);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [view, cursor]);

  const agendaQ = useQuery({
    queryKey: ["unified-agenda", range.from, range.to],
    queryFn: async () => {
      const res = (await runList({
        data: { from: range.from, to: range.to },
      })) as { items: AgendaItem[] };
      return res.items ?? [];
    },
  });

  // Memoised so the `?? []` fallback does not mint a fresh array on every
  // render, which would invalidate the byDay memo below while the query
  // has no data yet.
  const items = useMemo(() => agendaQ.data ?? [], [agendaQ.data]);

  const byDay = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const it of items) {
      const k = localDayKey(it.startsAt);
      const arr = m.get(k) ?? [];
      arr.push(it);
      m.set(k, arr);
    }
    return m;
  }, [items]);

  const sourceLabel = (s: string) => {
    const map: Record<string, string> = {
      task: t.navTasks,
      family_event: t.r4Calendar ?? "Family",
      money: t.navMoney,
      helpme: t.navHelpMe,
      warranty: t.r3Warranty ?? "Warranty",
    };
    return map[s] ?? s;
  };

  const openEdit = (it: AgendaItem) => {
    if (!it.editable) {
      toast.message(t.agendaNotEditable ?? "แก้ไขไม่ได้");
      return;
    }
    setEdit(it);
    setEditTitle(it.title);
    const d = new Date(it.startsAt);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setEditWhen(local);
    setEditNotes(it.detail || "");
    setAiText("");
  };

  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells: Array<{ date: Date | null; key: string }> = [];
    for (let i = 0; i < startPad; i++) cells.push({ date: null, key: `e${i}` });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), d);
      cells.push({ date, key: localDayKey(date) });
    }
    return cells;
  }, [cursor]);

  const selectedDayItems =
    view === "month" || view === "day" ? (byDay.get(localDayKey(cursor)) ?? []) : items;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t.agendaTitle ?? "ปฏิทินรวม"}</h1>
            <p className="text-sm text-muted-foreground">
              {t.agendaSub ?? "งาน · ครอบครัว · เอกสาร · ช่วยฉันที"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["list", t.agendaViewList ?? "รายการ"],
                ["day", t.agendaViewDay ?? "วัน"],
                ["week", t.agendaViewWeek ?? "สัปดาห์"],
                ["month", t.agendaViewMonth ?? "เดือน"],
              ] as const
            ).map(([k, label]) => (
              <Button
                key={k}
                size="sm"
                variant={view === k ? "default" : "outline"}
                onClick={() => setView(k)}
              >
                {k === "list" ? (
                  <List className="mr-1 size-3.5" />
                ) : (
                  <CalendarDays className="mr-1 size-3.5" />
                )}
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const n = new Date(cursor);
              if (view === "month") n.setMonth(n.getMonth() - 1);
              else n.setDate(n.getDate() - (view === "week" ? 7 : 1));
              setCursor(startOfDay(n));
            }}
          >
            ‹
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCursor(startOfDay(new Date()))}>
            {t.agendaToday ?? "วันนี้"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const n = new Date(cursor);
              if (view === "month") n.setMonth(n.getMonth() + 1);
              else n.setDate(n.getDate() + (view === "week" ? 7 : 1));
              setCursor(startOfDay(n));
            }}
          >
            ›
          </Button>
          <span className="text-sm text-muted-foreground">
            {view === "month"
              ? cursor.toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
                  month: "long",
                  year: "numeric",
                })
              : view === "week"
                ? (() => {
                    const from = startOfDay(cursor);
                    const day = from.getDay();
                    from.setDate(from.getDate() - ((day + 6) % 7)); // Monday
                    const to = new Date(from);
                    to.setDate(to.getDate() + 6); // Sunday
                    const loc = lang === "th" ? "th-TH" : "en-US";
                    const fmt = (d: Date) =>
                      d.toLocaleDateString(loc, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      });
                    return `${fmt(from)} – ${fmt(to)}`;
                  })()
                : formatDay(cursor, lang)}
          </span>
        </div>

        {agendaQ.isLoading && (
          <Loader2 className="mx-auto my-8 size-6 animate-spin text-muted-foreground" />
        )}

        {view === "month" && (
          <div className="mb-4 grid grid-cols-7 gap-1 text-center text-xs">
            {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((d) => (
              <div key={d} className="py-1 text-muted-foreground">
                {d}
              </div>
            ))}
            {monthCells.map((c) => {
              if (!c.date) return <div key={c.key} />;
              const key = localDayKey(c.date);
              const count = byDay.get(key)?.length ?? 0;
              const selected = localDayKey(cursor) === key;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`relative rounded-lg border p-2 ${
                    selected ? "border-primary bg-primary/10" : "border-border"
                  }`}
                  onClick={() => setCursor(startOfDay(c.date!))}
                >
                  <span>{c.date.getDate()}</span>
                  {count > 0 && (
                    <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
                      {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                        <span key={i} className="size-1 rounded-full bg-primary" />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <ul className="space-y-2">
          {(view === "list" ? items : view === "week" ? items : selectedDayItems).map((it) => (
            <li
              key={`${it.source}-${it.id}`}
              className="rounded-xl border border-border bg-card p-3 text-sm shadow-soft"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline">{sourceLabel(it.source)}</Badge>
                    <Badge variant="secondary">{it.status}</Badge>
                  </div>
                  <p className="mt-1 font-medium">{it.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDay(new Date(it.startsAt), lang)} ·{" "}
                    {new Date(it.startsAt).toLocaleTimeString(lang === "th" ? "th-TH" : "en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  {it.detail ? (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{it.detail}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  {it.editable && (
                    <Button size="sm" variant="outline" onClick={() => openEdit(it)}>
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                  <Link to={it.href} className="text-center text-[10px] text-primary underline">
                    เปิด
                  </Link>
                </div>
              </div>
            </li>
          ))}
          {!agendaQ.isLoading && items.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">
              {t.agendaEmpty ?? "ไม่มีรายการในช่วงนี้"}
            </p>
          )}
        </ul>

        {edit && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
            <div className="w-full max-w-md space-y-3 rounded-2xl bg-background p-4 shadow-lg">
              <h2 className="font-semibold">{t.agendaEdit ?? "แก้ไขรายการ"}</h2>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              <Input
                type="datetime-local"
                value={editWhen}
                onChange={(e) => setEditWhen(e.target.value)}
              />
              <Textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="หมายเหตุ"
              />
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-xs font-medium flex items-center gap-1">
                  <Sparkles className="size-3.5" />
                  {t.agendaAiEdit ?? "สั่งแก้ด้วย AI"}
                </p>
                <Input
                  placeholder={t.agendaAiPlaceholder ?? "เช่น เลื่อนไปพรุ่งนี้ 10 โมง"}
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !aiText.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const res = (await runAi({
                        data: {
                          source: edit.source as "task" | "family_event" | "helpme",
                          id: edit.id,
                          instruction: aiText.trim(),
                          lang,
                        },
                      })) as { summary: string };
                      toast.success(res.summary);
                      setEdit(null);
                      void qc.invalidateQueries({ queryKey: ["unified-agenda"] });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t.error);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t.agendaAiApply ?? "ให้ AI แก้"}
                </Button>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEdit(null)}>
                  {t.cancel ?? "ยกเลิก"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await runUpdate({
                        data: {
                          source: edit.source as "task" | "family_event" | "helpme",
                          id: edit.id,
                          title: editTitle.trim(),
                          startsAt: editWhen ? new Date(editWhen).toISOString() : undefined,
                          notes: editNotes,
                        },
                      });
                      toast.success(t.saved);
                      setEdit(null);
                      void qc.invalidateQueries({ queryKey: ["unified-agenda"] });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t.error);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t.save ?? "บันทึก"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
