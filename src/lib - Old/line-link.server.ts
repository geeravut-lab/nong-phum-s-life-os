import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkFriend, lineChannelToken } from "./line-push.server";

// LINE account linking. Endpoints and parameters from the LINE Login docs
// (developers.line.biz "Integrating LINE Login with a web app" and "Get
// profile information from ID tokens", read 2026-09-14).
//
// Flow (the browser only ever relays `code` and `state`; secrets stay here):
//   startLink   → state row bound to the signed-in user, 10 min → authorize URL
//   finishLink  → state must exist, be unexpired AND belong to the caller
//                 (a state minted for another account is refused: that is
//                 the login-CSRF case) → code → token → verify ID token with
//                 LINE → sub → friendship status with the user's own access
//                 token, then revoke that token → upsert line_links
//
// Why a page route + authenticated server function rather than a bare GET
// route for the callback: the app keeps its Supabase session in the browser,
// not in a cookie, so a plain GET from LINE's redirect carries no identity.
// Binding the state to the caller of finishLink is what makes the link land
// on the account that started it.

const AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const REVOKE_URL = "https://api.line.me/oauth2/v2.1/revoke";
const FRIENDSHIP_URL = "https://api.line.me/friendship/v1/status";

const STATE_TTL_MS = 10 * 60_000;
const CALLBACK_PATH = "/line/callback";
// redirect_uri must match a Callback URL registered on the LINE Login channel
// exactly. Registered: production, plus localhost for development.
const ALLOWED_ORIGINS = new Set(["https://lavieos.netlify.app", "http://localhost:5173"]);

export type LineLinkErrorCode =
  | "not_configured"
  | "bad_origin"
  | "state_invalid"
  | "state_expired"
  | "state_mismatch"
  | "line_denied"
  | "token_exchange_failed"
  | "id_token_invalid"
  | "line_id_in_use"
  | "profile_check_failed";

export class LineLinkError extends Error {
  constructor(
    public readonly code: LineLinkErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = "LineLinkError";
  }
}

function channel() {
  const id = process.env["LINE_LOGIN_CHANNEL_ID"];
  const secret = process.env["LINE_LOGIN_CHANNEL_SECRET"];
  if (!id || !secret) throw new LineLinkError("not_configured", "LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET not set");
  return { id, secret };
}

/** Public add-friend URL of the OA (line.me/R/ti/p/@… or lin.ee/…). Optional. */
export function addFriendUrl(): string | null {
  return process.env["LINE_OA_ADD_FRIEND_URL"] || null;
}

export type LineLinkView = {
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  isFriend: boolean;
  friendCheckedAt: string | null;
  linkedAt: string;
  blockedAt: string | null;
};

export async function getLink(userId: string): Promise<LineLinkView | null> {
  const { data, error } = await supabaseAdmin.from("line_links").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`line_links read: ${error.message}`);
  if (!data) return null;
  return {
    lineUserId: data.line_user_id,
    displayName: data.display_name,
    pictureUrl: data.picture_url,
    isFriend: data.is_friend,
    friendCheckedAt: data.friend_checked_at,
    linkedAt: data.linked_at,
    blockedAt: data.blocked_at,
  };
}

/** Mints a state for this user and returns the LINE authorize URL to send them to. */
export async function startLink(userId: string, origin: string): Promise<{ url: string; state: string }> {
  const { id } = channel();
  if (!ALLOWED_ORIGINS.has(origin)) throw new LineLinkError("bad_origin", origin);

  const state = randomBytes(32).toString("base64url");
  const { error } = await supabaseAdmin.from("line_link_states").insert({
    state,
    user_id: userId,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`line_link_states insert: ${error.message}`);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    redirect_uri: origin + CALLBACK_PATH,
    state,
    scope: "openid profile",
    // Shows "add the OA as a friend" on its own screen after consent. Needs
    // the OA linked to this LINE Login channel in the LINE Developers console.
    bot_prompt: "aggressive",
  });
  return { url: `${AUTHORIZE_URL}?${params}`, state };
}

type FinishInput = {
  userId: string;
  origin: string;
  code: string;
  state: string;
  /** LINE's `friendship_status_changed` query parameter, when present. */
  friendshipStatusChanged: boolean | null;
};

/** Completes the flow for the signed-in user. Every failure is a LineLinkError with a code the UI can translate. */
export async function finishLink(input: FinishInput): Promise<LineLinkView> {
  const { id, secret } = channel();
  if (!ALLOWED_ORIGINS.has(input.origin)) throw new LineLinkError("bad_origin", input.origin);

  // 1. Consume the state: it must exist, be fresh, and be THIS user's.
  const { data: st, error: stErr } = await supabaseAdmin
    .from("line_link_states")
    .delete()
    .eq("state", input.state)
    .select("user_id, expires_at")
    .maybeSingle();
  if (stErr) throw new Error(`line_link_states consume: ${stErr.message}`);
  if (!st) throw new LineLinkError("state_invalid");
  if (st.user_id !== input.userId) throw new LineLinkError("state_mismatch");
  if (new Date(st.expires_at).getTime() < Date.now()) throw new LineLinkError("state_expired");

  // 2. code → tokens (client_secret never leaves the server).
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.origin + CALLBACK_PATH,
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    console.error(`[line] token exchange ${tokenRes.status}: ${body.slice(0, 300)}`);
    throw new LineLinkError("token_exchange_failed", `LINE answered ${tokenRes.status}`);
  }
  const tokens = (await tokenRes.json()) as { access_token?: string; id_token?: string };
  if (!tokens.access_token || !tokens.id_token) throw new LineLinkError("token_exchange_failed", "no tokens in response");

  try {
    // 3. Verify the ID token WITH LINE — never decode-and-trust.
    const verifyRes = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: tokens.id_token, client_id: id }),
    });
    if (!verifyRes.ok) {
      const body = await verifyRes.text().catch(() => "");
      console.error(`[line] id token verify ${verifyRes.status}: ${body.slice(0, 300)}`);
      throw new LineLinkError("id_token_invalid", `LINE answered ${verifyRes.status}`);
    }
    const claims = (await verifyRes.json()) as { sub?: string; name?: string; picture?: string };
    if (!claims.sub || !/^U[0-9a-f]{32}$/.test(claims.sub)) throw new LineLinkError("id_token_invalid", "no usable sub");

    // 4. Friendship with the OA, asked with the user's own token while we have it.
    let isFriend = false;
    const fsRes = await fetch(FRIENDSHIP_URL, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    if (fsRes.ok) {
      const fs = (await fsRes.json()) as { friendFlag?: boolean };
      isFriend = fs.friendFlag === true;
    } else {
      // Not fatal: the link still stands, the UI will say "not a friend yet".
      console.warn(`[line] friendship status ${fsRes.status} (is the OA linked to the LINE Login channel?)`);
      if (input.friendshipStatusChanged === true) isFriend = true;
    }

    // 5. Store. One LINE account per Life OS account and vice versa.
    const { error: upErr } = await supabaseAdmin.from("line_links").upsert(
      {
        user_id: input.userId,
        line_user_id: claims.sub,
        display_name: claims.name ?? null,
        picture_url: claims.picture ?? null,
        is_friend: isFriend,
        friend_checked_at: new Date().toISOString(),
        // linked_at is left to its default on insert and untouched on
        // re-link, so it keeps meaning "first connected".
        blocked_at: null,
      },
      { onConflict: "user_id" },
    );
    if (upErr) {
      if (upErr.code === "23505") throw new LineLinkError("line_id_in_use");
      throw new Error(`line_links upsert: ${upErr.message}`);
    }
    console.info(`[line] linked user=${input.userId} friend=${isFriend}`);
  } finally {
    // 6. We keep nothing that needs this token; revoke it (best effort).
    fetch(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: tokens.access_token, client_id: id, client_secret: secret }),
    }).catch(() => undefined);
  }

  const view = await getLink(input.userId);
  if (!view) throw new Error("line_links row missing after upsert");
  return view;
}

/**
 * Re-reads the friendship status with the OA's own channel token
 * (GET /v2/bot/profile/{userId}: 200 = friend, 404 = not / blocked). No
 * OAuth round-trip, no consent screen — the user just taps "check again".
 */
export async function recheckFriend(userId: string): Promise<LineLinkView> {
  const token = lineChannelToken();
  if (!token) throw new LineLinkError("not_configured", "LINE_CHANNEL_ACCESS_TOKEN not set");
  const current = await getLink(userId);
  if (!current) throw new Error("no LINE link to check");
  const res = await checkFriend(token, current.lineUserId);
  if (!res.ok) throw new LineLinkError("profile_check_failed", `LINE answered ${res.status}`);
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("line_links")
    .update({
      is_friend: res.friend,
      friend_checked_at: now,
      blocked_at: res.friend ? null : (current.blockedAt ?? now),
      ...(res.displayName ? { display_name: res.displayName } : {}),
      ...(res.pictureUrl ? { picture_url: res.pictureUrl } : {}),
    })
    .eq("user_id", userId);
  if (error) throw new Error(`line_links update: ${error.message}`);
  const view = await getLink(userId);
  if (!view) throw new Error("line_links row missing after update");
  return view;
}

export async function unlink(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("line_links").delete().eq("user_id", userId);
  if (error) throw new Error(`line_links delete: ${error.message}`);
  console.info(`[line] unlinked user=${userId}`);
}
