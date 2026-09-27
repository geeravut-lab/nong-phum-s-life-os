import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  getUsageStats,
  getAiCostStats,
  type AiCostRow,
  type UsageStats,
} from "@/lib/usage.functions";

export const Route = createFileRoute("/_authenticated/admin_/usage")({
  head: () => ({ meta: routeMeta("admin") }),
  beforeLoad: async ({ context }) => {
    const userId = (context as { user?: { id: string } }).user?.id;
    if (!userId) throw redirect({ to: "/today" });
    const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (data !== true) throw redirect({ to: "/today" });
  },
  component: AdminUsagePage,
});

function AdminUsagePage() {
  const { t } = useI18n();
  const load = useServerFn(getUsageStats);
  const load2 = useServerFn(getAiCostStats);
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["usage-stats", days],
    queryFn: () => load({ data: { days } }) as Promise<UsageStats>,
  });

  const costQ = useQuery({
    queryKey: ["ai-cost-stats", days],
    queryFn: () =>
      load2({ data: { days } }) as Promise<{
        rows: AiCostRow[];
        totalCalls: number;
        totalCostThb: number;
        hasUnpriced: boolean;
      }>,
  });

  const stats = q.data;
  // One scale for the bars, so the lengths mean something relative to each other.
  const topMax = Math.max(1, ...(stats?.topPaths ?? []).map((p) => p.views));
  const dayMax = Math.max(1, ...(stats?.daily ?? []).map((d) => d.views));

  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">
          <Link to="/admin" className="underline">
            {t.adminTitle}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.usageTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.usageSub}</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            [7, t.usageRange7],
            [30, t.usageRange30],
            [90, t.usageRange90],
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
      ) : !stats ? (
        <p className="text-sm text-muted-foreground">{t.usageEmpty}</p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                [t.usageDau, stats.dau],
                [t.usageWau, stats.wau],
                [t.usageMau, stats.mau],
                [t.usageTotalViews, stats.totalViews],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-border bg-card p-3 text-center shadow-soft"
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="text-sm font-semibold">{t.usageTopPaths}</h2>
            <p className="mb-2 text-xs text-muted-foreground">{t.usageWindow(stats.days)}</p>
            {stats.topPaths.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t.usageEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {stats.topPaths.map((p) => (
                  <li key={p.path}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{p.path}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {p.views.toLocaleString()} {t.usageViews} · {p.users.toLocaleString()}{" "}
                        {t.usageUsers}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-primary"
                        style={{ width: `${Math.round((p.views / topMax) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="text-sm font-semibold">{t.usagePerDay}</h2>
            <p className="mb-2 text-xs text-muted-foreground">{t.usageWindow(stats.days)}</p>
            {stats.daily.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t.usageEmpty}</p>
            ) : (
              <div className="flex h-32 items-end gap-1 overflow-x-auto">
                {stats.daily.map((d) => (
                  <div
                    key={d.day}
                    className="flex min-w-[8px] flex-1 flex-col items-center justify-end"
                    title={`${d.day}: ${d.views} ${t.usageViews} · ${d.users} ${t.usageUsers}`}
                  >
                    <div
                      className="w-full rounded-t bg-primary"
                      style={{ height: `${Math.max(2, Math.round((d.views / dayMax) * 100))}%` }}
                    />
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">
              {stats.daily[0]?.day} → {stats.daily[stats.daily.length - 1]?.day}
            </p>
          </section>

          {/* What the AI actually cost. The pricing review had to estimate this
              from the size of the prompts in the source; now it is measured. */}
          <section className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="text-sm font-semibold">{t.costTitle}</h2>
            <p className="mb-2 text-xs text-muted-foreground">{t.costSub}</p>
            {(costQ.data?.rows ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">{t.costEmpty}</p>
            ) : (
              <>
                <p className="mb-2 text-sm">
                  {t.costTotal}: ฿{(costQ.data?.totalCostThb ?? 0).toFixed(2)} ·{" "}
                  {(costQ.data?.totalCalls ?? 0).toLocaleString()} {t.costCalls}
                </p>
                <ul className="space-y-2 text-sm">
                  {(costQ.data?.rows ?? []).map((r) => (
                    <li
                      key={`${r.task}-${r.model}`}
                      className="rounded-lg border border-border p-2"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {r.task} · {r.model}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.costThb != null
                            ? `฿${r.costThb.toFixed(2)} · ฿${(r.costPerCallThb ?? 0).toFixed(3)} ${t.costPerCall}`
                            : "—"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.calls.toLocaleString()} {t.costCalls} · {t.costTokens}{" "}
                        {r.inputTokens.toLocaleString()}/{r.outputTokens.toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
                {costQ.data?.hasUnpriced ? (
                  <p className="mt-2 text-[10px] text-muted-foreground">{t.costUnpriced}</p>
                ) : null}
              </>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
