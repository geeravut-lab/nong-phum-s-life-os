// LINE Messaging API, the parts the tick and the admin page need. Endpoints
// and error semantics from developers.line.biz/en/reference/messaging-api
// (read 2026-09-14):
//   * GET  /v2/bot/profile/{userId}  200 = friend (or messaged us lately),
//          404 = not a friend / blocked / no consent
//   * POST /v2/bot/message/push      200 even when the user blocked us (then
//          nothing is delivered and nothing is counted); 400 = bad user id
//          for this channel; 429 = rate limit OR monthly limit reached;
//          409 = a request with the same X-Line-Retry-Key was already accepted
//   * GET  /v2/bot/message/quota and /quota/consumption
//   * POST /v2/bot/message/validate/push checks a message without sending or
//          counting — how the card layouts are tested for free
// Relative imports only: bundled into netlify/functions/tick.mts by esbuild.
import type { FlexMessage } from "./line-flex";

const API = "https://api.line.me";
const TIMEOUT_MS = 8_000;

export function lineChannelToken(): string | null {
  return process.env["LINE_CHANNEL_ACCESS_TOKEN"] || null;
}

/**
 * Where the card's button goes. Default: the site in the phone's own browser,
 * not LINE's in-app one — `openExternalBrowser=1` is LINE's documented query
 * parameter for that (docs "Using LINE features with the LINE URL scheme",
 * read 2026-09-19); the in-app browser broke some features for the owner.
 * With LINE_LIFF_ID set the button opens the LIFF app instead; the docs say
 * the parameter has no effect on LIFF URLs, so the two are either/or.
 */
export function appOpenUrl(path = "/today"): string {
  const liff = process.env["LINE_LIFF_ID"];
  return liff ? `https://liff.line.me/${liff}${path}` : `https://lavieos.netlify.app${path}?openExternalBrowser=1`;
}

async function call(path: string, init: RequestInit & { token: string }): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(API + path, {
      ...init,
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${init.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export type FriendCheck =
  | { ok: true; friend: boolean; displayName?: string; pictureUrl?: string }
  | { ok: false; kind: "auth" | "retryable"; status: number; message: string };

export async function checkFriend(token: string, lineUserId: string): Promise<FriendCheck> {
  let res: Response;
  try {
    res = await call(`/v2/bot/profile/${encodeURIComponent(lineUserId)}`, { method: "GET", token });
  } catch (err) {
    return { ok: false, kind: "retryable", status: 0, message: err instanceof Error ? err.message : String(err) };
  }
  if (res.status === 200) {
    const p = (await res.json()) as { displayName?: string; pictureUrl?: string };
    return { ok: true, friend: true, ...(p.displayName ? { displayName: p.displayName } : {}), ...(p.pictureUrl ? { pictureUrl: p.pictureUrl } : {}) };
  }
  if (res.status === 404) return { ok: true, friend: false };
  const message = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) return { ok: false, kind: "auth", status: res.status, message };
  return { ok: false, kind: "retryable", status: res.status, message };
}

export type PushResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; kind: "auth" | "target" | "quota" | "retryable"; status: number; message: string };

/**
 * One push to one user. `retryKey` must be stable per delivery (the
 * notification_log row id): a retry of a request LINE already accepted comes
 * back as 409 and is treated as sent, so a crash after send cannot double up.
 */
export async function pushFlex(token: string, lineUserId: string, flex: FlexMessage, retryKey: string): Promise<PushResult> {
  let res: Response;
  try {
    res = await call("/v2/bot/message/push", {
      method: "POST",
      token,
      headers: { "X-Line-Retry-Key": retryKey },
      body: JSON.stringify({ to: lineUserId, messages: [flex] }),
    });
  } catch (err) {
    return { ok: false, kind: "retryable", status: 0, message: err instanceof Error ? err.message : String(err) };
  }
  if (res.ok) return { ok: true, duplicate: false };
  if (res.status === 409) return { ok: true, duplicate: true };
  const message = (await res.text().catch(() => "")).slice(0, 500);
  if (res.status === 401 || res.status === 403) return { ok: false, kind: "auth", status: res.status, message };
  if (res.status === 400) return { ok: false, kind: "target", status: res.status, message };
  if (res.status === 429 && /monthly/i.test(message)) return { ok: false, kind: "quota", status: res.status, message };
  return { ok: false, kind: "retryable", status: res.status, message };
}

/** Free: validates message objects without sending or counting. */
export async function validateFlex(token: string, flex: FlexMessage): Promise<{ ok: boolean; status: number; message: string }> {
  const res = await call("/v2/bot/message/validate/push", { method: "POST", token, body: JSON.stringify({ messages: [flex] }) });
  return { ok: res.ok, status: res.status, message: res.ok ? "" : (await res.text().catch(() => "")).slice(0, 500) };
}

export type LineQuota = { limitType: string | null; limit: number | null; totalUsage: number | null; error: string | null };

/** LINE's own view of this month. `totalUsage` may lag behind reality (docs). */
export async function getQuota(token: string): Promise<LineQuota> {
  try {
    const [q, c] = await Promise.all([
      call("/v2/bot/message/quota", { method: "GET", token }),
      call("/v2/bot/message/quota/consumption", { method: "GET", token }),
    ]);
    if (!q.ok || !c.ok) return { limitType: null, limit: null, totalUsage: null, error: `quota ${q.status} / consumption ${c.status}` };
    const quota = (await q.json()) as { type?: string; value?: number };
    const cons = (await c.json()) as { totalUsage?: number };
    return {
      limitType: quota.type ?? null,
      limit: typeof quota.value === "number" ? quota.value : null,
      totalUsage: typeof cons.totalUsage === "number" ? cons.totalUsage : null,
      error: null,
    };
  } catch (err) {
    return { limitType: null, limit: null, totalUsage: null, error: err instanceof Error ? err.message : String(err) };
  }
}
