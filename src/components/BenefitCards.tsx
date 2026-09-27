import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/useAuthUser";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { benefitTitle, matchBenefits, type BenefitProfile, type BenefitRow } from "@/lib/benefits";

const STATUSES = ["interested", "in_progress", "received"] as const;
type Status = (typeof STATUSES)[number];

/**
 * The benefit cards the chat answer points at.
 *
 * The router has always been able to return list_benefits, and the prompt has
 * always told Nong Phum that "the app then shows interactive benefit cards
 * under your reply" - but nothing rendered them, so the reply pointed at a
 * list that was not there. This is that list: the same match, the same three
 * status buttons and the same official link as the สิทธิฉัน page, in a shape
 * that fits under a chat message.
 */
export function BenefitCards({ limit = 5 }: { limit?: number }) {
  const { t, lang } = useI18n();
  const { user } = useAuthUser();
  const qc = useQueryClient();

  const benefitsQ = useQuery({
    queryKey: ["benefits-catalog"],
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
      return (data ?? null) as unknown as BenefitProfile | null;
    },
  });

  const mineQ = useQuery({
    queryKey: ["user-benefits", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_benefits")
        .select("benefit_id, status")
        .eq("user_id", user!.id);
      return data ?? [];
    },
  });

  const setStatus = async (benefitId: string, status: Status) => {
    if (!user) return;
    const { error } = await supabase
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

  if (!benefitsQ.data) return null;

  // Only what they plausibly qualify for. A chat answer is not the place for
  // the full catalogue - the สิทธิฉัน page is, and the last row says so.
  const matches = matchBenefits(benefitsQ.data, profileQ.data ?? null)
    .filter((m) => m.level !== "not")
    .slice(0, limit);
  if (matches.length === 0) return null;

  const statusLabel: Record<Status, string> = {
    interested: t.benStatusInterested,
    in_progress: t.benStatusInProgress,
    received: t.benStatusReceived,
  };
  const statusOf = (id: string) =>
    ((mineQ.data ?? []).find((r) => r.benefit_id === id)?.status as Status | undefined) ?? null;

  return (
    <div className="ml-10 space-y-2">
      {matches.map(({ benefit, level }) => {
        const mine = statusOf(benefit.id);
        return (
          <article
            key={benefit.id}
            className="rounded-2xl border border-border bg-card p-3 shadow-soft"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{benefitTitle(benefit, lang)}</h3>
              <Badge variant={level === "eligible" ? "default" : "secondary"}>
                {level === "eligible" ? t.benEligible : t.benMaybe}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{benefit.provider}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{benefit.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={mine === s ? "default" : "outline"}
                  onClick={() => void setStatus(benefit.id, s)}
                >
                  {statusLabel[s]}
                </Button>
              ))}
              {benefit.link && (
                <a
                  href={benefit.link}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-flex items-center gap-1 text-xs text-primary underline"
                >
                  {t.benLink} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
