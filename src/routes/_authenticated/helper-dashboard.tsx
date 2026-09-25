import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";
import { JobWorkspace } from "@/components/JobWorkspace";

export const Route = createFileRoute("/_authenticated/helper-dashboard")({
  head: () => ({ meta: routeMeta("helpme") }),
  component: HelperDashboardPage,
});

function HelperDashboardPage() {
  const { t } = useI18n();
  const { user } = useAuthUser();

  const profile = useQuery({
    queryKey: ["helper-profile"],
    queryFn: async () => {
      const { data } = await supabase
        .from("helper_profiles")
        .select("*")
        .eq("user_id", user?.id ?? "")
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const jobs = useQuery({
    queryKey: ["helper-dashboard-jobs", profile.data?.id],
    queryFn: async () => {
      if (!profile.data?.id) return [];
      const { data } = await supabase
        .from("jobs")
        .select(
          "id, user_id, title, status, payment_status, agreed_price, scheduled_at, booked_at, no_show, job_payments(payment_status, provider_amount, payout_status)",
        )
        .eq("assigned_helper_id", profile.data.id)
        .order("updated_at", { ascending: false })
        .limit(40);
      return data ?? [];
    },
    enabled: !!profile.data?.id,
  });

  const offers = useQuery({
    queryKey: ["helper-dashboard-offers", profile.data?.id],
    queryFn: async () => {
      if (!profile.data?.id) return [];
      const { data } = await supabase
        .from("job_offers")
        .select("id, job_id, price, status, expires_at, round, jobs(title, status)")
        .eq("helper_id", profile.data.id)
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
    enabled: !!profile.data?.id,
  });

  const earnings = (jobs.data ?? []).reduce((s, j) => {
    const pays = j.job_payments
      ? Array.isArray(j.job_payments)
        ? j.job_payments
        : [j.job_payments]
      : [];
    const p = pays[0] as { payout_status?: string; provider_amount?: number } | undefined;
    if (p?.payout_status === "paid") return s + Number(p.provider_amount ?? 0);
    return s;
  }, 0);

  const active = (jobs.data ?? []).filter((j) =>
    ["matched", "in_progress"].includes(j.status),
  ).length;
  const done = (jobs.data ?? []).filter((j) => j.status === "done" || j.status === "completed").length;
  const pendingOffers = (offers.data ?? []).filter((o) => o.status === "pending" || o.status === "sent").length;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthJobs = (jobs.data ?? []).filter((j) => j.booked_at && new Date(j.booked_at) >= monthStart).length;


  return (
    <AppShell>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t.providerDashTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.providerDashSub}</p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3 text-center shadow-soft">
          <p className="text-2xl font-semibold">{active}</p>
          <p className="text-[10px] text-muted-foreground">{t.r6StatActive}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center shadow-soft">
          <p className="text-2xl font-semibold">{done}</p>
          <p className="text-[10px] text-muted-foreground">{t.r6StatDone}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center shadow-soft">
          <p className="text-2xl font-semibold">{pendingOffers}</p>
          <p className="text-[10px] text-muted-foreground">{t.r6StatOffers}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center shadow-soft">
          <p className="text-2xl font-semibold">{formatMoney(earnings)}</p>
          <p className="text-[10px] text-muted-foreground">{t.r6StatEarn} ({monthJobs} {t.r6StatMonthJobs})</p>
        </div>
      </section>


      {!profile.data ? (
        <p className="text-sm text-muted-foreground">{t.providerDashNoProfile}</p>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Stat label={t.providerDashRating} value={Number(profile.data.rating).toFixed(1)} />
            <Stat label={t.providerDashJobsDone} value={String(profile.data.jobs_done)} />
            <Stat label={t.providerDashEarnings} value={`฿${formatMoney(earnings)}`} />
          </div>
          <p className="mb-2 text-sm text-muted-foreground">
            {t.providerDashActive}: {active}
          </p>

          <section className="mb-6 space-y-3">
            <h2 className="font-semibold">{t.providerDashMyJobs}</h2>
            {(jobs.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{t.noJobs}</p>
            )}
            {(jobs.data ?? []).map((job) => (
              <article key={job.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">{job.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : ""}
                      {job.agreed_price != null ? ` · ฿${formatMoney(Number(job.agreed_price))}` : ""}
                    </p>
                  </div>
                  <Badge>{job.status}</Badge>
                </div>
                {["matched", "in_progress", "done"].includes(job.status) && (
                  <JobWorkspace jobId={job.id} enabled counterpartyUserId={job.user_id} />
                )}
              </article>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">{t.providerDashOffers}</h2>
            {(offers.data ?? []).map((o) => (
              <article key={o.id} className="rounded-xl border border-border p-3 text-sm">
                <p className="font-medium">{(o.jobs as { title?: string } | null)?.title ?? o.job_id}</p>
                <p className="text-xs text-muted-foreground">
                  {o.price != null ? `฿${formatMoney(Number(o.price))}` : ""} · {o.status}
                  {o.round > 1 ? ` · round ${o.round}` : ""}
                  {o.expires_at ? ` · exp ${new Date(o.expires_at).toLocaleString()}` : ""}
                </p>
              </article>
            ))}
          </section>
        </>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
