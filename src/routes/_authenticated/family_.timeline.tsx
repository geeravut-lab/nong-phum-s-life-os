import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { formatDay } from "@/lib/format";
import { getFamilyTimeline, type TimelineItem } from "@/lib/family-timeline.functions";

export const Route = createFileRoute("/_authenticated/family_/timeline")({
  head: () => ({ meta: routeMeta("family") }),
  component: FamilyTimelinePage,
});

function FamilyTimelinePage() {
  const { t, lang } = useI18n();
  const load = useServerFn(getFamilyTimeline);
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["family-timeline", days],
    queryFn: () =>
      load({ data: { days } }) as Promise<{ items: TimelineItem[]; familyId: string | null }>,
  });

  const kindLabel = (k: TimelineItem["kind"]) =>
    k === "event"
      ? t.tlKindEvent
      : k === "checkin"
        ? t.tlKindCheckin
        : k === "routine_log"
          ? t.tlKindRoutine
          : k === "task"
            ? t.tlKindTask
            : k === "expense"
              ? t.tlKindExpense
              : t.tlKindDocument;

  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">
          <Link to="/family" className="underline">
            {t.navFamily}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.tlTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.tlSub}</p>
      </header>

      <div className="mb-4 flex gap-2">
        {(
          [
            [30, t.tlRange30],
            [90, t.tlRange90],
          ] as const
        ).map(([n, label]) => (
          <Button
            key={n}
            size="sm"
            variant={days === n ? "default" : "outline"}
            onClick={() => setDays(n)}
          >
            {label}
          </Button>
        ))}
      </div>

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !q.data?.familyId ? (
        <p className="text-sm text-muted-foreground">{t.tlNoFamily}</p>
      ) : (q.data?.items ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.tlEmpty}</p>
      ) : (
        <ol className="space-y-2">
          {(q.data?.items ?? []).map((i) => (
            <li key={i.id} className="rounded-2xl border border-border bg-card p-3 shadow-soft">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link to={i.href} className="font-medium hover:underline">
                  {i.title || kindLabel(i.kind)}
                </Link>
                <Badge variant="outline" className="text-xs">
                  {kindLabel(i.kind)}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDay(new Date(i.at), lang, true)}
                {i.who ? ` · ${i.who}` : ""}
                {i.kind === "expense" && i.detail
                  ? ` · ฿${Number(i.detail).toLocaleString()}`
                  : i.kind === "event" && i.detail
                    ? ` · ${formatDay(new Date(i.detail), lang, true)}`
                    : i.detail
                      ? ` · ${i.detail}`
                      : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </AppShell>
  );
}
