import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Shareable "My Benefits" result.
 *
 * The blueprint wants this twice over: as a feature of สิทธิฉัน and as the
 * growth loop (check your entitlements, send the list to a parent).
 *
 * Two deliberate constraints:
 *
 * 1. The client sends benefit IDs, never the text to display. The server
 *    resolves titles from the benefits catalogue and stores that as the
 *    snapshot, so nothing a caller types can end up rendered on a public page.
 *    Only the sender's own short message is free text, and it is length-capped.
 * 2. The share holds a snapshot, not a live query, and never the eligibility
 *    profile. Age, income and household details produced the result but have no
 *    reason to travel in a link, and a snapshot means editing the profile later
 *    cannot change what an already-sent link shows.
 */

export type SharedBenefit = {
  title: string;
  provider: string | null;
  summary: string | null;
  estValue: string | null;
};

function token(): string {
  // 32 hex chars from the platform CSPRNG. Unguessable, and the only
  // credential the public page requires.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export const createBenefitShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        benefitIds: z.array(z.string().uuid()).min(1).max(40),
        message: z.string().max(300).optional(),
        lang: z.enum(["th", "en"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const lang = data.lang === "en" ? "en" : "th";

    // Resolved server-side from the catalogue, so the snapshot can only ever
    // contain real benefits.
    const { data: rows, error } = await supabaseAdmin
      .from("benefits")
      .select("id, title, title_en, summary, provider, est_value, is_active")
      .in("id", data.benefitIds)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("no matching benefits");

    const snapshot: SharedBenefit[] = rows.map((b) => ({
      title: ((lang === "en" ? b.title_en || b.title : b.title) as string) ?? "",
      provider: (b.provider as string | null) ?? null,
      summary: (b.summary as string | null) ?? null,
      estValue: (b.est_value as string | null) ?? null,
    }));

    const shareToken = token();
    const { error: insErr } = await supabaseAdmin.from("benefit_shares").insert({
      user_id: context.userId,
      share_token: shareToken,
      snapshot,
      message: data.message?.trim() ?? "",
    });
    if (insErr) throw new Error(insErr.message);

    return { token: shareToken, count: snapshot.length };
  });

/**
 * Public read. Intentionally has no auth middleware: the token is the
 * credential. Expiry and revocation are enforced here rather than by RLS,
 * because the table has no anon policy at all - so a leaked anon key cannot
 * enumerate shares even though this path can read one by token.
 */
export const readBenefitShare = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z
          .string()
          .length(32)
          .regex(/^[0-9a-f]+$/),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("benefit_shares")
      .select("id, snapshot, message, expires_at, revoked_at, view_count, created_at")
      .eq("share_token", data.token)
      .maybeSingle();

    // One indistinguishable answer for missing, revoked and expired, so the
    // page cannot be used to probe which tokens once existed.
    if (!row || row.revoked_at || new Date(row.expires_at as string) < new Date()) {
      return { ok: false as const };
    }

    await supabaseAdmin
      .from("benefit_shares")
      .update({ view_count: ((row.view_count as number) ?? 0) + 1 })
      .eq("id", row.id as string);

    return {
      ok: true as const,
      benefits: (row.snapshot ?? []) as SharedBenefit[],
      message: (row.message as string) ?? "",
      sharedAt: row.created_at as string,
    };
  });

export const listMyBenefitShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("benefit_shares")
      .select("id, share_token, view_count, expires_at, revoked_at, created_at, snapshot")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    return {
      shares: (data ?? []).map((s) => ({
        id: s.id as string,
        token: s.share_token as string,
        viewCount: (s.view_count as number) ?? 0,
        expiresAt: s.expires_at as string,
        revokedAt: (s.revoked_at as string | null) ?? null,
        createdAt: s.created_at as string,
        count: Array.isArray(s.snapshot) ? (s.snapshot as unknown[]).length : 0,
      })),
    };
  });

export const revokeBenefitShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("benefit_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
