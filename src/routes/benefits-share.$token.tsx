import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { readBenefitShare, type SharedBenefit } from "@/lib/benefit-share.functions";

export const Route = createFileRoute("/benefits-share/$token")({
  component: SharedBenefitsPage,
});

/**
 * Public page for a shared benefits result. No login: the token in the url is
 * the credential, and the server function decides whether it is still valid.
 * Deliberately shows only the benefit list and the sender's note - never the
 * eligibility profile behind it.
 */
function SharedBenefitsPage() {
  const { token } = Route.useParams();
  const { t } = useI18n();
  const run = useServerFn(readBenefitShare);

  const q = useQuery({
    queryKey: ["benefit-share", token],
    queryFn: async () =>
      (await run({ data: { token } })) as
        { ok: false } | { ok: true; benefits: SharedBenefit[]; message: string; sharedAt: string },
  });

  return (
    <div className="min-h-screen bg-hero-gradient px-4 py-10">
      <div className="mx-auto max-w-lg">
        <header className="mb-5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{t.benSharePageTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.benShareIntro}</p>
        </header>

        {q.isLoading ? (
          <Loader2 className="mx-auto size-6 animate-spin" />
        ) : !q.data?.ok ? (
          <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">
            {t.benShareExpired}
          </p>
        ) : (
          <>
            {q.data.message ? (
              <p className="mb-4 rounded-xl border border-border bg-card p-3 text-sm shadow-soft">
                {q.data.message}
              </p>
            ) : null}

            <p className="mb-2 text-xs text-muted-foreground">
              {q.data.benefits.length} {t.benShareCount}
            </p>
            <ul className="space-y-2">
              {q.data.benefits.map((b, i) => (
                <li
                  key={`${b.title}-${i}`}
                  className="rounded-xl border border-border bg-card p-3 shadow-soft"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{b.title}</span>
                    {b.estValue ? (
                      <Badge variant="secondary" className="shrink-0">
                        {b.estValue}
                      </Badge>
                    ) : null}
                  </div>
                  {b.provider ? (
                    <p className="mt-1 text-xs text-muted-foreground">{b.provider}</p>
                  ) : null}
                  {b.summary ? <p className="mt-1 text-xs">{b.summary}</p> : null}
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-2xl border border-border bg-card p-4 text-center shadow-soft">
              <ShieldCheck className="mx-auto mb-2 size-5 text-primary" />
              <Button asChild>
                <Link to="/auth">{t.benShareCta}</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
