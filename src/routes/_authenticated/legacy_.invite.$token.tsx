import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { acceptVerifierInvite, previewVerifierInvite } from "@/lib/death.functions";

export const Route = createFileRoute("/_authenticated/legacy_/invite/$token")({
  head: () => ({ meta: routeMeta("legacy") }),
  component: LegacyInvitePage,
});

function LegacyInvitePage() {
  const { token } = Route.useParams();
  const { t } = useI18n();
  const runPreview = useServerFn(previewVerifierInvite);
  const runAccept = useServerFn(acceptVerifierInvite);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    found: boolean;
    contactName?: string;
    inviteStatus?: string;
    displayLabel?: string;
    planCode?: string | null;
  } | null>(null);
  const [done, setDone] = useState<{ planCode: string | null; contactName: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await runPreview({ data: { token } });
        setPreview(res);
      } catch {
        setPreview({ found: false });
      }
    })();
  }, [token, runPreview]);

  const onAccept = async () => {
    setBusy(true);
    try {
      const res = await runAccept({ data: { token } });
      setDone({ planCode: res.planCode, contactName: res.contactName });
      toast.success(t.invAccepted);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">{t.invTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.invSub}</p>
      </header>

      {!preview && (
        <p className="text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline size-4 animate-spin" />
          …
        </p>
      )}

      {preview && !preview.found && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {t.invNotFound}
        </p>
      )}

      {preview?.found && !done && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-sm">
            <span className="font-medium">{t.invRole}</span>: {preview.contactName}
          </p>
          {preview.displayLabel ? (
            <p className="text-sm text-muted-foreground">
              {t.invForPlan}: {preview.displayLabel}
            </p>
          ) : null}
          {preview.inviteStatus === "accepted" ? (
            <p className="text-sm text-muted-foreground">{t.invAlready}</p>
          ) : (
            <Button disabled={busy} onClick={onAccept}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldCheck className="mr-2 size-4" />}
              {t.invAcceptBtn}
            </Button>
          )}
        </section>
      )}

      {done && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-medium">{t.invAccepted}</p>
          {done.planCode ? (
            <p className="text-sm">
              {t.invPlanCode}: <span className="font-mono font-semibold">{done.planCode}</span>
            </p>
          ) : null}
          <Link to="/legacy/after" className="text-sm text-primary underline">
            {t.invGoAfter}
          </Link>
        </section>
      )}
    </AppShell>
  );
}
