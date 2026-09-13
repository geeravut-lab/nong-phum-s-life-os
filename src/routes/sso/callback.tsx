import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { exchangeSsoTicket, type SsoExchangeResponse } from "@/lib/sso.functions";
import { useI18n } from "@/lib/i18n";
import { PhumMark } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

// Landing page for Aivora Hub SSO. The hub redirects here with ?sso_ticket=…
// The ticket is single-use and lives 60 seconds, which drives two rules below:
// it is scrubbed from the URL before the first await (a refresh must not
// resend it), and nothing here ever loops back to exchange it again.

export const Route = createFileRoute("/sso/callback")({
  ssr: false,
  head: () => ({ meta: [{ title: "เข้าสู่ระบบด้วย Aivora | น้องภูมิ" }] }),
  component: SsoCallbackPage,
});

const FLOW_TIMEOUT_MS = 15_000;
const SET_SESSION_ATTEMPTS = 3;

type Status = { step: "working"; label: string } | { step: "failed"; code: string; detail: string };

function SsoCallbackPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>({ step: "working", label: "" });
  const started = useRef(false);

  useEffect(() => {
    // React StrictMode mounts twice in dev; the ticket must only be used once.
    if (started.current) return;
    started.current = true;

    // 1. Read the ticket and remove it from the address bar synchronously —
    //    before any await — so a refresh or a copied URL cannot replay it.
    const ticket = new URLSearchParams(window.location.search).get("sso_ticket");
    window.history.replaceState(null, "", "/sso/callback");

    const fail = (code: string, detail: string) => {
      console.error(`[sso] failed at ${code}: ${detail}`);
      setStatus({ step: "failed", code, detail });
    };

    const run = async () => {
      if (!ticket) {
        fail("no_ticket", "sso_ticket query parameter is missing");
        return;
      }
      console.info("[sso] 1/6 ticket found");
      setStatus({ step: "working", label: t.ssoExchanging });

      // 2. Exchange once. On failure this is final — see the header comment.
      let exchanged: SsoExchangeResponse;
      try {
        exchanged = await exchangeSsoTicket({ data: { ticket } });
      } catch (err) {
        fail("exchange_crashed", err instanceof Error ? err.message : String(err));
        return;
      }
      if (!exchanged.ok) {
        fail(exchanged.code, `server answered ${exchanged.status}`);
        return;
      }
      console.info("[sso] 2/6 ticket exchanged");
      // Tokens live only in this closure from here on.
      const { access_token, refresh_token } = exchanged;

      // 3. Establish the session. Only THIS step is retried; the ticket is gone.
      setStatus({ step: "working", label: t.ssoSigningIn });
      let userId: string | null = null;
      let lastError = "";
      for (let attempt = 1; attempt <= SET_SESSION_ATTEMPTS && !userId; attempt++) {
        const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (!error && data.session?.user) {
          userId = data.session.user.id;
        } else {
          lastError = error?.message ?? "no session returned";
          console.warn(`[sso] setSession attempt ${attempt}/${SET_SESSION_ATTEMPTS} failed: ${lastError}`);
        }
      }
      if (!userId) {
        fail("set_session_failed", lastError);
        return;
      }
      console.info(`[sso] 3/6 session set user=${userId}`);

      // 4–5. Bootstrap. In this app that is the same path every login takes:
      //    the row in profiles was created by the on_auth_user_created trigger,
      //    and the pages load their own data on mount. Reading the profile here
      //    with the user's own session is a real check that the trigger ran and
      //    that RLS accepts an SSO-created user — not a second bootstrap.
      console.info("[sso] 4/6 bootstrap start");
      setStatus({ step: "working", label: t.ssoLoadingProfile });
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("id", userId)
        .maybeSingle();
      if (profileErr) {
        fail("profile_read_failed", profileErr.message);
        return;
      }
      if (!profile) {
        // Trigger did not run (should never happen). Create the row the same
        // way the trigger would, with only what the hub gave us.
        const { error: insErr } = await supabase
          .from("profiles")
          .insert({ id: userId, display_name: exchanged.profile.display_name });
        if (insErr) {
          fail("profile_create_failed", insErr.message);
          return;
        }
      }
      console.info("[sso] 5/6 profile ready");

      // 6. Hand over to the app exactly as the password login does.
      await navigate({ to: "/today" });
      console.info("[sso] 6/6 bootstrap done");
    };

    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`no progress after ${FLOW_TIMEOUT_MS / 1000}s`)), FLOW_TIMEOUT_MS),
    );
    Promise.race([run(), timeout]).catch((err) => {
      fail("timeout", err instanceof Error ? err.message : String(err));
    });
  }, [navigate, t]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-hero-gradient px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 text-center shadow-soft">
        <div className="mb-4 flex items-center justify-center gap-2">
          <PhumMark />
          <span className="text-lg font-semibold">{t.appName}</span>
        </div>
        {status.step === "working" ? (
          <>
            <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{status.label || t.ssoWorking}</p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold text-destructive">{t.ssoFailed}</p>
            <p className="mt-2 text-sm text-muted-foreground">{ssoErrorText(status.code, t)}</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {status.code}: {status.detail}
            </p>
            <Button asChild className="mt-5 w-full">
              <Link to="/auth">{t.ssoRetry}</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ssoErrorText(code: string, t: ReturnType<typeof useI18n>["t"]): string {
  switch (code) {
    case "invalid_ticket":
    case "no_ticket":
      return t.ssoErrTicket;
    case "app_mismatch":
      return t.ssoErrApp;
    case "email_in_use":
      return t.ssoErrEmailInUse;
    case "hub_unreachable":
    case "timeout":
      return t.ssoErrHub;
    default:
      return t.ssoErrGeneric;
  }
}
