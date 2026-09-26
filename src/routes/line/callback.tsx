import { routeMeta } from "@/lib/i18n.dict";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { finishLineLink, type LineLinkOutcome } from "@/lib/line.functions";
import { useI18n } from "@/lib/i18n";
import { PhumMark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

// Where LINE Login sends the browser back after the consent screen:
//   /line/callback?code=…&state=…[&friendship_status_changed=true|false]
//   /line/callback?error=access_denied&error_description=…&state=…
// The page relays code + state to the server once. The server owns every
// check that matters: the state was minted by a signed-in user and finishLink
// refuses it unless it belongs to the caller, which closes login-CSRF in both
// directions. There is deliberately NO browser-side state comparison: on a
// phone, LINE Login switches to the LINE app and comes back in a NEW tab, so
// anything kept in sessionStorage by the starting tab is not here (seen
// 2026-09-14 as client_state_mismatch on Android). Same shape as the Aivora
// SSO callback.

export const Route = createFileRoute("/line/callback")({
  ssr: false,
  head: () => ({ meta: routeMeta("line") }),
  component: LineCallbackPage,
});

type Status =
  | { step: "working" }
  | { step: "done"; link: Extract<LineLinkOutcome, { ok: true }>["link"] }
  | { step: "failed"; code: string };

function LineCallbackPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>({ step: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const q = new URLSearchParams(window.location.search);
    const code = q.get("code");
    const state = q.get("state");
    const lineError = q.get("error");
    const fsc = q.get("friendship_status_changed");
    // Scrub the one-time code from the address bar before anything awaits.
    window.history.replaceState(null, "", "/line/callback");

    const run = async () => {
      if (lineError) {
        setStatus({
          step: "failed",
          code: lineError === "access_denied" ? "line_denied" : "line_error",
        });
        return;
      }
      if (!code || !state) {
        setStatus({ step: "failed", code: "state_invalid" });
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setStatus({ step: "failed", code: "no_session" });
        return;
      }
      const result = await finishLineLink({
        data: {
          origin: window.location.origin,
          code,
          state,
          friendshipStatusChanged: fsc === null ? null : fsc === "true",
        },
      });
      if (result.ok) setStatus({ step: "done", link: result.link });
      else setStatus({ step: "failed", code: result.code });
    };
    run().catch((err) => {
      console.error("[line] callback crashed", err);
      setStatus({ step: "failed", code: "crashed" });
    });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-hero-gradient px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 text-center shadow-soft">
        <div className="mb-4 flex items-center justify-center gap-2">
          <PhumMark />
          <span className="text-lg font-semibold">{t.appName}</span>
        </div>
        {status.step === "working" && (
          <>
            <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{t.lineCallbackWorking}</p>
          </>
        )}
        {status.step === "done" && (
          <>
            <p className="text-lg font-semibold text-primary">{t.lineCallbackDone}</p>
            {status.link.displayName && (
              <p className="mt-2 text-sm text-muted-foreground">
                {t.lineLinkedAs(status.link.displayName)}
              </p>
            )}
            <p
              className={`mt-3 rounded-xl p-3 text-sm ${
                status.link.isFriend
                  ? "bg-primary/10 text-primary"
                  : "bg-destructive/10 font-medium text-destructive"
              }`}
            >
              {status.link.isFriend ? t.lineFriendYes : t.lineFriendNo}
            </p>
            <Button asChild className="mt-5 w-full">
              <Link to="/settings">{t.lineGoSettings}</Link>
            </Button>
          </>
        )}
        {status.step === "failed" && (
          <>
            <p className="text-lg font-semibold text-destructive">{t.lineCallbackFailed}</p>
            <p className="mt-2 text-sm text-muted-foreground">{lineErrorText(status.code, t)}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{status.code}</p>
            <Button asChild className="mt-5 w-full">
              <Link to="/settings">{t.lineGoSettings}</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function lineErrorText(code: string, t: ReturnType<typeof useI18n>["t"]): string {
  switch (code) {
    case "line_denied":
      return t.lineErrDenied;
    case "state_invalid":
    case "state_expired":
      return t.lineErrState;
    case "state_mismatch":
      return t.lineErrOtherAccount;
    case "no_session":
      return t.lineErrNoSession;
    case "line_id_in_use":
      return t.lineErrInUse;
    case "not_configured":
      return t.lineNotConfigured;
    default:
      return t.lineErrGeneric;
  }
}
