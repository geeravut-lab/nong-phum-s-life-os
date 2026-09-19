import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CalendarClock, FileText, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { generateDailyBrief } from "@/lib/lifeos.functions";
import { formatDay, formatMoney } from "@/lib/format";
import { bangkokDateAtHour, monthStartInBangkok, todayInBangkok } from "@/lib/time";
import { completeReminder } from "@/lib/reminder-actions";
import { isRepeating } from "@/lib/recurrence";

export const Route = createFileRoute("/_authenticated/today")({
  head: () => ({ meta: routeMeta("today") }),
  component: TodayPage,
});

function TodayPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const brief = useServerFn(generateDailyBrief);

  const { data, isLoading } = useQuery({
    queryKey: ["today"],
    queryFn: async () => {
      const monthStart = monthStartInBangkok();
      const nowIso = new Date().toISOString();
      const [profile, dueNow, reminders, expenses, docs] = await Promise.all([
        supabase.from("profiles").select("display_name").maybeSingle(),
        // Came due and nobody has dealt with it: the in-app notification for
        // everyone without a delivery channel (today, that is everyone).
        // Same predicate the tick uses to notify.
        supabase
          .from("reminders")
          .select("id, title, due_at, priority, recurrence")
          .eq("status", "open")
          .or(`notify_at.lte.${nowIso},and(notify_at.is.null,due_at.lte.${nowIso})`)
          .order("due_at", { ascending: true })
          .limit(20),
        supabase
          .from("reminders")
          .select("id, title, due_at, priority, recurrence")
          .eq("status", "open")
          .or(`due_at.gt.${nowIso},due_at.is.null`)
          .order("due_at", { ascending: true })
          .limit(6),
        supabase.from("expenses").select("amount").gte("spent_on", monthStart),
        supabase.from("documents").select("id", { count: "exact", head: true }).eq("kind", "analyzed"),
      ]);
      return {
        name: profile.data?.display_name ?? "",
        dueNow: dueNow.data ?? [],
        reminders: reminders.data ?? [],
        monthTotal: (expenses.data ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0),
        docCount: docs.count ?? 0,
      };
    },
  });

  const briefQuery = useQuery({
    queryKey: ["brief", lang],
    queryFn: () => brief({ data: { lang } }),
    staleTime: 1000 * 60 * 30,
  });

  const complete = useMutation({
    mutationFn: (r: { id: string; due_at: string | null; recurrence: string }) => completeReminder(r),
    onSuccess: ({ advancedTo }) => {
      qc.invalidateQueries({ queryKey: ["today"] });
      toast.success(advancedTo ? t.advancedTo(formatDay(advancedTo, lang)) : t.done);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const doneLabel = (r: { recurrence: string; due_at: string | null }) =>
    isRepeating(r.recurrence) && r.due_at
      ? r.recurrence === "monthly"
        ? t.markDoneNextMonth
        : t.markDoneNextYear
      : t.markDone;

  const now = Date.now();
  const dueNow = data?.dueNow ?? [];
  // A reminder with an early notify_at is due-now AND still upcoming by
  // due_at; show it once, in the due-now list.
  const dueNowIds = new Set(dueNow.map((r) => r.id));
  const upcoming = (data?.reminders ?? []).filter((r) => !dueNowIds.has(r.id));
  const urgent = upcoming.filter(
    (r) => r.due_at && new Date(r.due_at).getTime() < now + 3 * 86400000,
  );
  // "Overdue" = due before today (Bangkok), not merely before this minute.
  const dayStart = new Date(bangkokDateAtHour(todayInBangkok(), 0));

  return (
    <AppShell>
      <header className="mb-6">
        <p className="text-sm text-muted-foreground">{formatDay(new Date(), lang)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t.todayTitle} {data?.name ? `${data.name} 👋` : "👋"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {dueNow.length ? t.dueNowCount(dueNow.length) : urgent.length ? t.todayCount(urgent.length) : t.todayNone}
        </p>
      </header>

      {dueNow.length > 0 && (
        <section className="mb-5 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 shadow-soft">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" />
            {t.dueNow}
          </h2>
          <ul className="space-y-2">
            {dueNow.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{r.due_at ? formatDay(new Date(r.due_at), lang, true) : "—"}</span>
                    {r.due_at && new Date(r.due_at) < dayStart && <Badge variant="destructive">{t.overdue}</Badge>}
                    {isRepeating(r.recurrence) && (
                      <Badge variant="outline">{r.recurrence === "monthly" ? t.monthly : t.yearly}</Badge>
                    )}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={complete.isPending} onClick={() => complete.mutate(r)}>
                  {doneLabel(r)}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<CalendarClock className="size-4" />}
          label={t.openTasks}
          value={String(dueNow.length + upcoming.length)}
        />
        <StatCard
          icon={<Wallet className="size-4" />}
          label={t.monthSpend}
          value={formatMoney(data?.monthTotal ?? 0)}
        />
        <StatCard
          icon={<FileText className="size-4" />}
          label={t.docsCount}
          value={String(data?.docCount ?? 0)}
        />
      </div>

      <Card className="mt-5 border-primary/20 bg-primary/5 shadow-soft">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="size-4" />
            {t.briefFromPhum}
          </div>
          {briefQuery.isLoading ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {briefQuery.data?.text ?? t.todayNone}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 text-primary"
            onClick={() => briefQuery.refetch()}
            disabled={briefQuery.isFetching}
          >
            {briefQuery.isFetching ? t.loading : t.generateBrief}
          </Button>
        </CardContent>
      </Card>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t.upcoming}</h2>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : upcoming.length ? (
          <ul className="space-y-2">
            {upcoming.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    {r.priority === "high" && <AlertTriangle className="size-3 text-destructive" />}
                    {r.due_at ? formatDay(new Date(r.due_at), lang, true) : "—"}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={complete.isPending} onClick={() => complete.mutate(r)}>
                  {doneLabel(r)}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t.tasksEmpty}
          </p>
        )}
      </section>
    </AppShell>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-soft">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}</div>
      <p className="mt-2 text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
