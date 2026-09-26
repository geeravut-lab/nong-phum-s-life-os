import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Aivora Hub single sign-on. The browser hands us a one-shot ticket; this
// module turns it into a Supabase session. Every step here runs on the
// server: the hub is contacted with the ticket, the user is looked up or
// created with the service role, and the session comes back to the client as
// plain tokens. Nothing in this file may reach the client bundle — it is only
// ever pulled in by a lazy import inside a server function handler.

export const HUB_URL = "https://aivora-lc.netlify.app";
export const APP_SLUG = "lifeos";
const HUB_EXCHANGE_URL = `${HUB_URL}/api/public/sso/exchange`;
const HUB_TIMEOUT_MS = 10_000;
// E-mail for hub users who have none (LINE logins usually do not). Must be a
// domain we control so it can never collide with a real person's address.
const SYNTHETIC_EMAIL_DOMAIN = "lavieos.netlify.app";

// The hub sends null, not undefined, for fields it has no value for. A plain
// z.string() would reject every LINE user, who typically has no e-mail.
const nullableString = z.string().nullable().optional();

const HubResponse = z.object({
  user: z.object({
    id: z.string().min(1), // never relaxed: this is the only thing we link on
    display_name: nullableString,
    avatar_url: nullableString,
    email: nullableString,
    // Ignored on purpose. Roles are this app's business (user_roles), and a
    // hub role must never become a permission here.
    roles: z.unknown().optional(),
  }),
  app_slug: z.string(),
  // Supabase apps always get null here. That is the expected value, not an error.
  firebase: z.unknown().optional(),
});

export type HubUser = z.infer<typeof HubResponse>["user"];

export type SsoErrorCode =
  | "invalid_ticket" // 401 — hub rejected the ticket (used, expired, forged)
  | "app_mismatch" // 403 — ticket was issued for a different app
  | "bad_payload" // 502 — hub answered with a shape we do not understand
  | "hub_unreachable" // 502 — network / timeout / 5xx from the hub
  | "email_in_use" // 409 — hub e-mail already belongs to a local account (see below)
  | "session_failed"; // 500 — Supabase could not mint a session

export class SsoError extends Error {
  constructor(
    public readonly code: SsoErrorCode,
    public readonly status: 401 | 403 | 409 | 500 | 502,
    message: string,
  ) {
    super(message);
    this.name = "SsoError";
  }
}

export type SsoExchangeResult = {
  access_token: string;
  refresh_token: string;
  profile: { display_name: string | null; avatar_url: string | null };
};

/** Step 1: ticket → hub user. */
export async function exchangeWithHub(ticket: string): Promise<HubUser> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HUB_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(HUB_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new SsoError(
      "hub_unreachable",
      502,
      `hub fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (res.status >= 500) {
    throw new SsoError("hub_unreachable", 502, `hub returned ${res.status}`);
  }
  if (!res.ok) {
    // 400/401/404 from the hub all mean "this ticket is no good" from our side.
    let detail = text.slice(0, 200);
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? detail;
    } catch {
      /* keep raw text */
    }
    throw new SsoError("invalid_ticket", 401, `hub rejected ticket (${res.status}: ${detail})`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SsoError("bad_payload", 502, "hub response was not JSON");
  }
  const parsed = HubResponse.safeParse(json);
  if (!parsed.success) {
    throw new SsoError(
      "bad_payload",
      502,
      `hub response shape: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`,
    );
  }
  if (parsed.data.app_slug !== APP_SLUG) {
    throw new SsoError(
      "app_mismatch",
      403,
      `ticket is for app "${parsed.data.app_slug}", not "${APP_SLUG}"`,
    );
  }
  return parsed.data.user;
}

function syntheticEmailFor(hubId: string): string {
  // Only the local part is derived from the id; keep it to characters every
  // mail parser accepts.
  return `aivora+${hubId.replace(/[^a-zA-Z0-9._-]/g, "_")}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Step 2: hub user → local auth user, by hub id only.
 *
 * Never by e-mail. If the hub's e-mail already belongs to an account created
 * here, that account is NOT handed over: the hub cannot vouch that the address
 * was verified, and taking over on a string match is exactly the hole the
 * Firebase version's "aivora:" uid prefix existed to close. Linking two
 * accounts is a separate, deliberate feature for a signed-in user, not a side
 * effect of SSO.
 */
export async function findOrCreateLocalUser(
  hub: HubUser,
): Promise<{ userId: string; email: string; created: boolean }> {
  const { data: link, error: linkErr } = await supabaseAdmin
    .from("aivora_links")
    .select("user_id")
    .eq("aivora_user_id", hub.id)
    .maybeSingle();
  if (linkErr) throw new SsoError("session_failed", 500, `aivora_links lookup: ${linkErr.message}`);

  if (link) {
    const { data: existing, error } = await supabaseAdmin.auth.admin.getUserById(link.user_id);
    if (error || !existing.user) {
      throw new SsoError(
        "session_failed",
        500,
        `linked user ${link.user_id} missing: ${error?.message ?? "no user"}`,
      );
    }
    await fillEmptyProfileFields(existing.user.id, hub);
    return {
      userId: existing.user.id,
      email: existing.user.email ?? syntheticEmailFor(hub.id),
      created: false,
    };
  }

  const email = hub.email && hub.email.trim() !== "" ? hub.email.trim() : syntheticEmailFor(hub.id);
  const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { aivora_user_id: hub.id, provider: "aivora" },
    user_metadata: {
      display_name: hub.display_name ?? undefined,
      avatar_url: hub.avatar_url ?? undefined,
    },
  });
  if (createErr || !createdUser.user) {
    const msg = createErr?.message ?? "no user returned";
    if (/already|exists|registered/i.test(msg)) {
      throw new SsoError(
        "email_in_use",
        409,
        `hub e-mail already belongs to a local account; refusing to link by e-mail (hub id ${hub.id})`,
      );
    }
    throw new SsoError("session_failed", 500, `createUser: ${msg}`);
  }

  const { error: insertErr } = await supabaseAdmin
    .from("aivora_links")
    .insert({ aivora_user_id: hub.id, user_id: createdUser.user.id });
  if (insertErr) {
    // The auth user exists without a link; remove it so the next attempt
    // starts clean instead of hitting email_in_use forever.
    await supabaseAdmin.auth.admin.deleteUser(createdUser.user.id).catch(() => undefined);
    throw new SsoError("session_failed", 500, `aivora_links insert: ${insertErr.message}`);
  }
  // The on_auth_user_created trigger has already made the profiles and
  // user_roles rows (role = member, same as any signup). Nothing from the hub
  // decides permissions here.
  return { userId: createdUser.user.id, email, created: true };
}

/**
 * Existing users keep whatever they typed; only blanks are filled from the hub.
 *
 * "Blank" includes the placeholder the on_auth_user_created trigger derives
 * from a synthetic e-mail ("aivora+<id>") when the hub had no name at signup
 * time — otherwise a name the hub supplies on a later login could never land.
 */
function isPlaceholderName(name: string | null): boolean {
  return name == null || name.trim() === "" || name.startsWith("aivora+");
}

async function fillEmptyProfileFields(userId: string, hub: HubUser): Promise<void> {
  if (!hub.display_name) return;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (data && isPlaceholderName(data.display_name)) {
    await supabaseAdmin
      .from("profiles")
      .update({ display_name: hub.display_name })
      .eq("id", userId);
  }
}

/**
 * Step 3: e-mail → session tokens.
 *
 * generateLink() needs the service role and gives us a one-time magic-link
 * hash. Verifying that hash is a public auth endpoint, so it is called with
 * plain fetch and the publishable key rather than on the admin client:
 * supabase-js would otherwise store the resulting user session on the
 * service-role singleton and every later admin call would run as that user.
 */
export async function issueSession(
  email: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) {
    throw new SsoError(
      "session_failed",
      500,
      `generateLink: ${error?.message ?? "no hashed_token"}`,
    );
  }

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key)
    throw new SsoError("session_failed", 500, "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set");

  const res = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ type: "magiclink", token_hash: data.properties.hashed_token }),
  });
  if (!res.ok) {
    throw new SsoError(
      "session_failed",
      500,
      `verify: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  const session = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!session.access_token || !session.refresh_token) {
    throw new SsoError("session_failed", 500, "verify returned no tokens");
  }
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}

/** The whole flow. Logs every outcome, including the ones we throw on purpose — never a token or key. */
export async function runSsoExchange(ticket: string): Promise<SsoExchangeResult> {
  try {
    const hub = await exchangeWithHub(ticket);
    const local = await findOrCreateLocalUser(hub);
    const tokens = await issueSession(local.email);
    console.info(`[sso] ok user=${local.userId} hub=${hub.id} created=${local.created}`);
    return {
      ...tokens,
      profile: { display_name: hub.display_name ?? null, avatar_url: hub.avatar_url ?? null },
    };
  } catch (err) {
    if (err instanceof SsoError) {
      console.error(`[sso] ${err.status} ${err.code}: ${err.message}`);
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sso] 500 unexpected: ${message}`);
    throw new SsoError("session_failed", 500, message);
  }
}
