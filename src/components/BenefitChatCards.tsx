import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useI18n } from "@/lib/i18n";
import {
  benefitTitle,
  matchBenefits,
  type BenefitProfile,
  type BenefitRow,
  type MatchLevel,
} from "@/lib/benefits";

const STATUSES = ["interested", "in_progress", "received"] as const;
type Status = (typeof STATUSES)[number];

export function BenefitChatCards() {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();

  const benefitsQ = useQuery({
    queryKey: ["benefits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("benefits")
        .select("*")
        .eq("is_active", true)
        .order("category");
      if (error) throw error;
      return (data ?? []) as unknown as BenefitRow[];
    },
  });

  const profileQ = useQuery({
    queryKey: ["benefit-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("benefit_profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const myQ = useQuery({
    queryKey: ["user-benefits", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_benefits")
        .select("benefit_id,status")
        .eq("user_id", user!.id);
      return data ?? [];
    },
  });

  const p = profileQ.data;
  const profile: BenefitProfile | null = p
    ? {
        birth_year: p.birth_year,
        monthly_income: p.monthly_income,
        occupation: p.occupation,
        province: p.province,
        household_size: p.household_size,
        groups: p.groups ?? [],
        has_social_security: p.has_social_security,
        has_welfare_card: p.has_welfare_card,
      }
    : null;

  const matches = matchBenefits(benefitsQ.data ?? [], profile)
    .filter((m) => m.level !== "not")
    .slice(0, 5);

  const statusOf = (id: string) =>
    (myQ.data?.find((r) => r.benefit_id === id)?.status ?? null) as Status | null;

  const setStatus = async (benefitId: string, status: Status) => {
    if (!user) return;
    const current = statusOf(benefitId);
    const { error } =
      current === status
        ? await supabase
            .from("user_benefits")
            .delete()
            .eq("user_id", user.id)
            .eq("benefit_id", benefitId)
        : await supabase
            .from("user_benefits")
            .upsert(
              { user_id: user.id, benefit_id: benefitId, status },
              { onConflict: "user_id,benefit_id" },
            );
    if (error) {
      toast.error(error.message);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["user-benefits", user.id] });
  };

  const levelBadge: Record<MatchLevel, { label: string; className: string }> = {
    eligible: { label: t.benEligible, className: "bg-primary text-primary-foreground" },
    maybe: { label: t.benMaybe, className: "bg-secondary text-secondary-foreground" },
    not: { label: t.benNot, className: "bg-muted text-muted-foreground" },
  };

  const statusLabel: Record<Status, string> = {
    interested: t.benStatusInterested,
    in_progress: t.benStatusInProgress,
    received: t.benStatusReceived,
  };

  if (!matches.length) return null;

  return (
    <div className="mt-2 grid gap-2">
      {!profile ? (
        <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t.benEmptyProfile}
        </p>
      ) : null}
      {matches.map(({ benefit, level, reasons }) => {
        const mine = statusOf(benefit.id);
        return (
          <article key={benefit.id} className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <h4 className="min-w-0 text-sm font-semibold">{benefitTitle(benefit, lang)}</h4>
              <Badge className={`${levelBadge[level].className} shrink-0`}>
                {levelBadge[level].label}
              </Badge>
            </div>
            {reasons.length ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {lang === "en" ? reasons[0]!.en : reasons[0]!.th}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={mine === s ? "default" : "outline"}
                  onClick={() => setStatus(benefit.id, s)}
                >
                  {statusLabel[s]}
                </Button>
              ))}
              {benefit.link ? (
                <a
                  href={benefit.link}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-flex items-center gap-1 text-xs text-primary underline"
                >
                  {t.benLink} <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
      <Link to="/benefits" className="text-xs text-primary underline">
        {t.benOpenPage}
      </Link>
    </div>
  );
}
