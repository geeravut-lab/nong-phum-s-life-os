import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { listSafetyReports, updateSafetyReport } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin_/safety")({
  head: () => ({ meta: routeMeta("admin") }),
  beforeLoad: async ({ context }) => {
    const userId = (context as { user?: { id: string } }).user?.id;
    if (!userId) throw redirect({ to: "/today" });
    const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (data !== true) throw redirect({ to: "/today" });
  },
  component: AdminSafetyPage,
});

function AdminSafetyPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(listSafetyReports);
  const update = useServerFn(updateSafetyReport);
  const q = useQuery({ queryKey: ["safety-reports"], queryFn: () => load() });

  const mut = useMutation({
    mutationFn: (x: { id: string; status: "open" | "reviewing" | "resolved" | "dismissed" }) =>
      update({ data: x }),
    onSuccess: () => {
      toast.success(t.saved);
      qc.invalidateQueries({ queryKey: ["safety-reports"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t.error),
  });

  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">
          <Link to="/admin" className="underline">
            {t.adminTitle}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{t.safetyAdminTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.safetyAdminSub}</p>
      </header>

      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !(q.data ?? []).length ? (
        <p className="text-sm text-muted-foreground">{t.safetyAdminEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {(q.data ?? []).map((r) => (
            <li key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {r.reason}
                    {r.is_emergency ? (
                      <Badge variant="destructive" className="ml-2">
                        {t.emergencyBadge}
                      </Badge>
                    ) : null}
                  </p>
                  {r.details && <p className="mt-1 text-sm text-muted-foreground">{r.details}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()} · job {r.job_id?.slice(0, 8) ?? "—"}
                  </p>
                </div>
                <Badge variant="outline">{r.status}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["reviewing", "resolved", "dismissed"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={r.status === s ? "default" : "outline"}
                    disabled={mut.isPending || r.status === s}
                    onClick={() => mut.mutate({ id: r.id, status: s })}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
