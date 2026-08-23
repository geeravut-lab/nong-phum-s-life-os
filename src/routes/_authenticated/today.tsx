import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CalendarClock, FileText, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { generateDailyBrief } from "@/lib/lifeos.functions";
import { formatDay, formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/today")({
  head: () => ({
    meta: [
      { title: "วันนี้ | น้องภูมิ" },
      { name: "description", content: "สรุปเรื่องสำคัญของวันนี้ ทั้งงานค้าง บิลใกล้ครบกำหนด และเอกสารที่ต้องดู" },
      { property: "og:title", content: "วันนี้ | น้องภูมิ" },
      { property: "og:description", content: "สรุปเรื่องสำคัญของวันนี้ ทั้งงานค้าง บิลใกล้ครบกำหนด และเอกสารที่ต้องดู" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TodayPage,
});

function TodayPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const brief = useServerFn(generateDailyBrief);

  const { data, isLoading } = useQuery({
    queryKey: ["today"],
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      const [profile, reminders, expenses, docs] = await Promise.all([
        supabase.from("profiles").select("display_name").maybeSingle(),
        supabase
          .from("reminders")
          .select("id, title, due_at, priority, status")
          .eq("status", "open")
          .order("due_at", { ascending: true })
          .limit(6),
        supabase
          .from("expenses")
          .select("amount")
          .gte("spent_on", monthStart.toISOString().slice(0, 10)),
        supabase.from("documents").select("id", { count: "exact", head: true }),
      ]);
      return {
        name: profile.data?.display_name ?? "",
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
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reminders").update({ status: "done" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
      toast.success(t.done);
    },
  });

  const now = Date.now();
  const urgent = (data?.reminders ?? []).filter(
    (r) => r.due_at && new Date(r.due_at).getTime() < now + 3 * 86400000,
  );

  return (
    <AppShell>
      <header className="mb-6">
        <p className="text-sm text-muted-foreground">{formatDay(new Date(), lang)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t.todayTitle} {data?.name ? `${data.name} 👋` : "👋"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {urgent.length ? t.todayCount(urgent.length) : t.todayNone}
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<CalendarClock className="size-4" />}
          label={t.openTasks}
          value={String(data?.reminders.length ?? 0)}
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
        ) : data?.reminders.length ? (
          <ul className="space-y-2">
            {data.reminders.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    {r.priority === "high" && (
                      <AlertTriangle className="size-3 text-destructive" />
                    )}
                    {r.due_at ? formatDay(new Date(r.due_at), lang, true) : "—"}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => complete.mutate(r.id)}>
                  {t.markDone}
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

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-soft">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}</div>
      <p className="mt-2 text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
