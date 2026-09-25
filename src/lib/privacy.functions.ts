import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Lazy server-only admin client (keeps this module importable from client routes). */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function writePrivacyAudit(
  userId: string,
  action: string,
  detail = "",
  meta: Record<string, string | number | boolean | null> = {},
) {
  const supabaseAdmin = await admin();
  await supabaseAdmin.from("privacy_audit_log").insert({
    user_id: userId,
    action,
    detail,
    meta,
  });
}

export const listPrivacyAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await admin();
    const { data, error } = await supabaseAdmin
      .from("privacy_audit_log")
      .select("id, action, detail, meta, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { logs: data ?? [] };
  });

export const logPrivacyAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        action: z.string().min(1).max(80),
        detail: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await writePrivacyAudit(context.userId, data.action, data.detail ?? "");
    return { ok: true as const };
  });

export const updatePrivacyPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        shareLocationHelpme: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.shareLocationHelpme === undefined) return { ok: true as const };

    const supabaseAdmin = await admin();
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ share_location_helpme: data.shareLocationHelpme })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    await writePrivacyAudit(
      context.userId,
      data.shareLocationHelpme ? "location_share_on" : "location_share_off",
      "Help Me location sharing preference",
    );
    return { ok: true as const };
  });

export const getMyPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await admin();
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("plan_tier, plan_expires_at, share_location_helpme")
      .eq("id", context.userId)
      .maybeSingle();

    const { data: sub } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, plan_tier, status, started_at, expires_at, notes")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      planTier: (profile?.plan_tier as string) || "free",
      planExpiresAt: (profile?.plan_expires_at as string | null) ?? null,
      shareLocationHelpme: Boolean(profile?.share_location_helpme),
      subscription: sub ?? null,
    };
  });

/** Skeleton: start trial / switch plan without real payment gateway yet */
export const startPlanTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        planTier: z.enum(["premium", "family"]),
        days: z.number().int().min(1).max(30).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await admin();
    const days = data.days ?? 14;
    const expires = new Date(Date.now() + days * 864e5).toISOString();

    const { error: sErr } = await supabaseAdmin.from("user_subscriptions").insert({
      user_id: context.userId,
      plan_tier: data.planTier,
      status: "trialing",
      expires_at: expires,
      notes: "trial_skeleton",
    });
    if (sErr) throw new Error(sErr.message);

    await supabaseAdmin
      .from("profiles")
      .update({ plan_tier: data.planTier, plan_expires_at: expires })
      .eq("id", context.userId);

    await writePrivacyAudit(
      context.userId,
      "plan_trial_start",
      `${data.planTier} trial ${days}d`,
    );

    return { planTier: data.planTier, expiresAt: expires };
  });

export const setPromotedListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        target: z.enum(["helper", "local_place"]),
        id: z.string().uuid(),
        isPromoted: z.boolean(),
        untilDays: z.number().int().min(1).max(90).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await admin();
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    const until = data.isPromoted
      ? new Date(Date.now() + (data.untilDays ?? 30) * 864e5).toISOString()
      : null;

    if (data.target === "helper") {
      const { data: hp } = await supabaseAdmin
        .from("helper_profiles")
        .select("id, user_id")
        .eq("id", data.id)
        .single();
      if (!hp) throw new Error("not found");
      if (hp.user_id !== context.userId && !isAdmin) throw new Error("Forbidden");

      if (data.isPromoted && !isAdmin) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("plan_tier")
          .eq("id", context.userId)
          .maybeSingle();
        if ((prof?.plan_tier as string) === "free") {
          throw new Error("ต้องการแพ็ก Premium เพื่อโปรโมทโปรไฟล์");
        }
      }

      const { error } = await supabaseAdmin
        .from("helper_profiles")
        .update({ is_promoted: data.isPromoted, promoted_until: until } as never)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      if (!isAdmin) throw new Error("Admin only for local place promote (skeleton)");
      const { error } = await supabaseAdmin
        .from("local_places")
        .update({ is_promoted: data.isPromoted, promoted_until: until } as never)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    }

    await writePrivacyAudit(
      context.userId,
      data.isPromoted ? "listing_promote_on" : "listing_promote_off",
      `${data.target}:${data.id}`,
    );
    return { ok: true as const, promotedUntil: until };
  });
