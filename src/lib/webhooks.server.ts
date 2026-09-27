import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Notice } from "./notify.server";

/**
 * Sending a notification on to a url the user controls.
 *
 * The receiver is usually an automation service, which is how this app reaches
 * email, calendars and cloud storage without registering an OAuth app with
 * anyone. Deliveries are signed so the receiver can tell a real post from
 * anyone who guessed the url.
 */

const TIMEOUT_MS = 3000;
// Five consecutive failures is a dead endpoint, not a blip. It is deactivated
// rather than deleted, so the user can see what happened and switch it back on.
const MAX_FAILURES = 5;

/**
 * Hosts a webhook may not point at.
 *
 * Without this the field is a request forwarder: anyone could aim it at the
 * platform's own metadata service or something else inside the network and read
 * the reply through the delivery status. This blocks the obvious literals; it
 * does not defend against a hostname that resolves to a private address, which
 * needs resolution-time checks the runtime does not expose.
 */
function isAllowedUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return false;
  if (h === "metadata.google.internal") return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    if (a === 127 || a === 10 || a === 0 || a === 169) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  if (h.includes(":")) return false; // bare IPv6 literal, including ::1
  return true;
}

export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Best effort, and never throws: a webhook is a copy of something that already
 * happened in the app, so a failure to deliver it must not fail the action.
 */
export async function deliverWebhooks(userIds: string[], notice: Notice): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const { data: endpoints } = await supabaseAdmin
      .from("webhook_endpoints")
      .select("id, user_id, url, secret, events, failure_count")
      .in("user_id", userIds)
      .eq("is_active", true);
    if (!endpoints?.length) return;

    const body = JSON.stringify({
      kind: notice.kind,
      title: notice.title,
      body: notice.body,
      href: notice.href,
      params: notice.params ?? {},
      at: new Date().toISOString(),
    });

    await Promise.all(
      endpoints
        .filter((e) => {
          const events = (e.events ?? []) as string[];
          return events.length === 0 || events.includes(notice.kind);
        })
        .filter((e) => isAllowedUrl(e.url as string))
        .map(async (e) => {
          let status = 0;
          try {
            const res = await fetch(e.url as string, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-LifeOS-Event": notice.kind,
                "X-LifeOS-Signature": signPayload(e.secret as string, body),
              },
              body,
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            status = res.status;
          } catch {
            status = 0;
          }
          const ok = status >= 200 && status < 300;
          const failures = ok ? 0 : Number(e.failure_count ?? 0) + 1;
          await supabaseAdmin
            .from("webhook_endpoints")
            .update({
              last_status: status,
              last_at: new Date().toISOString(),
              failure_count: failures,
              ...(failures >= MAX_FAILURES ? { is_active: false } : {}),
            })
            .eq("id", e.id as string);
        }),
    );
  } catch (err) {
    console.warn("[webhook] delivery failed:", err instanceof Error ? err.message : err);
  }
}

export { isAllowedUrl };
