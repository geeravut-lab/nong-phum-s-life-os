import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function yearMonthBangkok(d = new Date()): string {
  // Approximate Bangkok month via +7 offset
  const t = new Date(d.getTime() + 7 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type BillingSettings = {
  marginPct: number;
  costFactor: number;
  freeChat: number;
  freeDocument: number;
  freeDecision: number;
  freeTranscribe: number;
  freeTotal: number;
  premiumMonthly: number;
  premiumYearly: number;
  familyMonthly: number;
  familyYearly: number;
  paygEnabled: boolean;
  paygUnitSatang: number;
  paygGraceDays: number;
  familyMaxMembers: number;
  promptpayId: string | null;
};

const DEFAULTS: BillingSettings = {
  marginPct: 20,
  costFactor: 1.18,
  freeChat: 40,
  freeDocument: 12,
  freeDecision: 8,
  freeTranscribe: 15,
  freeTotal: 60,
  premiumMonthly: 89,
  premiumYearly: 890,
  familyMonthly: 149,
  familyYearly: 1490,
  paygEnabled: false,
  paygUnitSatang: 50,
  paygGraceDays: 7,
  familyMaxMembers: 5,
  promptpayId: null,
};

async function loadBillingSettings(): Promise<BillingSettings> {
  const supabaseAdmin = await admin();
  // select * — billing columns may not be in generated types yet
  const { data } = await supabaseAdmin.from("platform_settings").select("*").maybeSingle();
  if (!data) return { ...DEFAULTS };
  const d = data as unknown as Record<string, unknown>;
  const n = (k: string, fb: number) => Number(d[k] ?? fb);
  return {
    marginPct: n("billing_margin_pct", DEFAULTS.marginPct),
    costFactor: n("billing_cost_factor", DEFAULTS.costFactor),
    freeChat: n("free_chat_limit", DEFAULTS.freeChat),
    freeDocument: n("free_document_limit", DEFAULTS.freeDocument),
    freeDecision: n("free_decision_limit", DEFAULTS.freeDecision),
    freeTranscribe: n("free_transcribe_limit", DEFAULTS.freeTranscribe),
    freeTotal: n("free_total_ai_limit", DEFAULTS.freeTotal),
    premiumMonthly: n("premium_price_monthly", DEFAULTS.premiumMonthly),
    premiumYearly: n("premium_price_yearly", DEFAULTS.premiumYearly),
    familyMonthly: n("family_price_monthly", DEFAULTS.familyMonthly),
    familyYearly: n("family_price_yearly", DEFAULTS.familyYearly),
    paygEnabled: Boolean(d["payg_enabled"] ?? false),
    paygUnitSatang: n("payg_unit_price_satang", DEFAULTS.paygUnitSatang),
    paygGraceDays: n("payg_grace_days", DEFAULTS.paygGraceDays),
    familyMaxMembers: n("family_max_members", DEFAULTS.familyMaxMembers),
    promptpayId:
      (d["billing_promptpay_id"] as string) ||
      (d["helpme_promptpay_id"] as string) ||
      (d["funeral_promptpay_id"] as string) ||
      null,
  };
}

async function isPremiumActive(userId: string): Promise<boolean> {
  const supabaseAdmin = await admin();
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("plan_tier, plan_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return false;
  const tier = profile.plan_tier as string;
  if (tier !== "premium" && tier !== "family") return false;
  if (profile.plan_expires_at && new Date(profile.plan_expires_at as string) < new Date()) {
    return false;
  }
  return true;
}

export const getBillingPublic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const settings = await loadBillingSettings();
    const ym = yearMonthBangkok();
    const supabaseAdmin = await admin();
    const { data: usage } = await supabaseAdmin
      .from("ai_usage_monthly")
      .select("chat_count, document_count, decision_count, transcribe_count, total_count")
      .eq("user_id", context.userId)
      .eq("year_month", ym)
      .maybeSingle();
    const premium = await isPremiumActive(context.userId);
    return {
      settings,
      usage: usage ?? {
        chat_count: 0,
        document_count: 0,
        decision_count: 0,
        transcribe_count: 0,
        total_count: 0,
      },
      yearMonth: ym,
      isPremium: premium,
      /** Human-readable pricing rationale (TH) */
      pricingExplain: {
        freeSummary: `ฟรี/เดือน: แชท ${settings.freeChat} · เอกสาร ${settings.freeDocument} · ตัดสินใจ ${settings.freeDecision} · เสียง ${settings.freeTranscribe} (รวมไม่เกิน ${settings.freeTotal} ครั้ง)`,
        premiumMonthly: settings.premiumMonthly,
        premiumYearly: settings.premiumYearly,
        yearlySavePct: Math.round(
          (1 - settings.premiumYearly / (settings.premiumMonthly * 12)) * 100,
        ),
        costBasis: `ต้นทุนอ้างอิง = ราคา API × ${settings.costFactor} (สูงกว่าค่าเฉลี่ย ~${Math.round((settings.costFactor - 1) * 100)}%) แล้วบวก margin ${settings.marginPct}%`,
        payg: settings.paygEnabled
          ? `Pay-as-you-go (สรุปยอดวันที่ 1 ของเดือน · ชำระภายใน grace days): ${settings.paygUnitSatang} สตางค์/ครั้งที่เกินโควต้าฟรี · ชำระภายใน ${settings.paygGraceDays} วัน มิฉะนั้นระบบจะระงับ AI จนกว่าจะชำระ (สมาชิก Premium ไม่ถูกคิด PAYG)`
          : null,
      },
    };
  });

export const getBillingAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await admin();
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    return loadBillingSettings();
  });

export const updateBillingAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        marginPct: z.number().min(0).max(100).optional(),
        costFactor: z.number().min(1).max(3).optional(),
        freeChat: z.number().int().min(0).max(10000).optional(),
        freeDocument: z.number().int().min(0).max(10000).optional(),
        freeDecision: z.number().int().min(0).max(10000).optional(),
        freeTranscribe: z.number().int().min(0).max(10000).optional(),
        freeTotal: z.number().int().min(0).max(50000).optional(),
        premiumMonthly: z.number().min(0).max(100000).optional(),
        premiumYearly: z.number().min(0).max(1000000).optional(),
        familyMonthly: z.number().min(0).max(100000).optional(),
        familyYearly: z.number().min(0).max(1000000).optional(),
        paygEnabled: z.boolean().optional(),
        paygUnitSatang: z.number().int().min(0).max(10000).optional(),
        paygGraceDays: z.number().int().min(1).max(90).optional(),
        familyMaxMembers: z.number().int().min(2).max(50).optional(),
        promptpayId: z.string().max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await admin();
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const patch: Record<string, unknown> = {};
    if (data.marginPct !== undefined) patch["billing_margin_pct"] = data.marginPct;
    if (data.costFactor !== undefined) patch["billing_cost_factor"] = data.costFactor;
    if (data.freeChat !== undefined) patch["free_chat_limit"] = data.freeChat;
    if (data.freeDocument !== undefined) patch["free_document_limit"] = data.freeDocument;
    if (data.freeDecision !== undefined) patch["free_decision_limit"] = data.freeDecision;
    if (data.freeTranscribe !== undefined) patch["free_transcribe_limit"] = data.freeTranscribe;
    if (data.freeTotal !== undefined) patch["free_total_ai_limit"] = data.freeTotal;
    if (data.premiumMonthly !== undefined) patch["premium_price_monthly"] = data.premiumMonthly;
    if (data.premiumYearly !== undefined) patch["premium_price_yearly"] = data.premiumYearly;
    if (data.familyMonthly !== undefined) patch["family_price_monthly"] = data.familyMonthly;
    if (data.familyYearly !== undefined) patch["family_price_yearly"] = data.familyYearly;
    if (data.paygEnabled !== undefined) patch["payg_enabled"] = data.paygEnabled;
    if (data.paygUnitSatang !== undefined) patch["payg_unit_price_satang"] = data.paygUnitSatang;
    if (data.paygGraceDays !== undefined) patch["payg_grace_days"] = data.paygGraceDays;
    if (data.familyMaxMembers !== undefined) patch["family_max_members"] = data.familyMaxMembers;
    if (data.promptpayId !== undefined) patch["billing_promptpay_id"] = data.promptpayId;

    const { error } = await supabaseAdmin
      .from("platform_settings")
      .update(patch as never)
      .eq("id", true);
    if (error) throw new Error(error.message);
    return loadBillingSettings();
  });

export type AiTaskKind = "chat" | "document" | "decision" | "transcribe";

/** Check quota; returns allowed + remaining. Premium always allowed. */
export const checkAndConsumeAiQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ task: z.enum(["chat", "document", "decision", "transcribe"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (await isPremiumActive(context.userId)) {
      return { allowed: true as const, reason: "premium" as const, remaining: null };
    }
    const settings = await loadBillingSettings();
    const ym = yearMonthBangkok();
    const supabaseAdmin = await admin();

    let { data: row } = await supabaseAdmin
      .from("ai_usage_monthly")
      .select("*")
      .eq("user_id", context.userId)
      .eq("year_month", ym)
      .maybeSingle();

    if (!row) {
      const { data: created } = await supabaseAdmin
        .from("ai_usage_monthly")
        .insert({ user_id: context.userId, year_month: ym })
        .select("*")
        .single();
      row = created;
    }

    const limits: Record<AiTaskKind, number> = {
      chat: settings.freeChat,
      document: settings.freeDocument,
      decision: settings.freeDecision,
      transcribe: settings.freeTranscribe,
    };
    const col: Record<AiTaskKind, string> = {
      chat: "chat_count",
      document: "document_count",
      decision: "decision_count",
      transcribe: "transcribe_count",
    };
    const usedTask = Number((row as Record<string, unknown>)[col[data.task]] ?? 0);
    const usedTotal = Number((row as Record<string, unknown>)["total_count"] ?? 0);

    if (usedTask >= limits[data.task] || usedTotal >= settings.freeTotal) {
      if (settings.paygEnabled) {
        return {
          allowed: false as const,
          reason: "payg_required" as const,
          remaining: 0,
          overageSatang: settings.paygUnitSatang,
          message: `เกินโควต้าฟรี — ชำระ ${settings.paygUnitSatang} สตางค์/ครั้ง หรืออัปเกรด Premium`,
        };
      }
      return {
        allowed: false as const,
        reason: "limit" as const,
        remaining: 0,
        message: "เกินโควต้าฟรีเดือนนี้ — อัปเกรด Premium ได้ที่เมนูสนับสนุน",
      };
    }

    const patch: Record<string, number> = {
      total_count: usedTotal + 1,
      [col[data.task]]: usedTask + 1,
    };
    await supabaseAdmin
      .from("ai_usage_monthly")
      .update({ ...patch, updated_at: new Date().toISOString() } as never)
      .eq("id", (row as { id: string }).id);

    return {
      allowed: true as const,
      reason: "free" as const,
      remaining: Math.min(
        limits[data.task] - usedTask - 1,
        settings.freeTotal - usedTotal - 1,
      ),
    };
  });

export const createPremiumOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        planTier: z.enum(["premium", "family"]),
        period: z.enum(["monthly", "yearly"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const settings = await loadBillingSettings();
    if (!settings.promptpayId) throw new Error("ยังไม่ได้ตั้ง PromptPay สำหรับบิลลิ่ง");

    const amount =
      data.planTier === "premium"
        ? data.period === "monthly"
          ? settings.premiumMonthly
          : settings.premiumYearly
        : data.period === "monthly"
          ? settings.familyMonthly
          : settings.familyYearly;

    const supabaseAdmin = await admin();
    const { data: row, error } = await supabaseAdmin
      .from("premium_payments")
      .insert({
        user_id: context.userId,
        plan_tier: data.planTier,
        period: data.period,
        amount,
        payment_status: "draft",
        promptpay_id: settings.promptpayId,
      })
      .select("id, amount, promptpay_id")
      .single();
    if (error) throw new Error(error.message);

    const amt = Number(row.amount);
    return {
      paymentId: row.id as string,
      amount: amt,
      promptpayId: row.promptpay_id as string,
      qrUrl: `https://promptpay.io/${row.promptpay_id}/${amt.toFixed(2)}`,
    };
  });

export const confirmPremiumPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        paymentId: z.string().uuid(),
        payerRef: z.string().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await admin();
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    const { data: pay, error } = await supabaseAdmin
      .from("premium_payments")
      .select("*")
      .eq("id", data.paymentId)
      .single();
    if (error || !pay) throw new Error(error?.message ?? "not found");
    if (pay.user_id !== context.userId && !isAdmin) throw new Error("Forbidden");
    // User reports transfer — draft → pending for admin
    if (pay.payment_status === "paid") return { ok: true as const, status: "paid" as const };
    if (pay.payment_status === "rejected") throw new Error("รายการนี้ถูกปฏิเสธแล้ว");

    await supabaseAdmin
      .from("premium_payments")
      .update({
        payment_status: "pending",
        payer_ref: data.payerRef ?? null,
      })
      .eq("id", data.paymentId);

    return { ok: true as const, status: "pending" as const };
  });

export const adminRejectPremiumPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ paymentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await admin();
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    await supabaseAdmin
      .from("premium_payments")
      .update({ payment_status: "rejected" })
      .eq("id", data.paymentId)
      .eq("payment_status", "pending");
    return { ok: true as const };
  });

/** Admin: mark premium payment paid and activate plan */
export const adminConfirmPremiumPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ paymentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await admin();
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: pay, error } = await supabaseAdmin
      .from("premium_payments")
      .select("*")
      .eq("id", data.paymentId)
      .single();
    if (error || !pay) throw new Error(error?.message ?? "not found");

    const start = new Date();
    const end = new Date(start);
    if (pay.period === "yearly") end.setFullYear(end.getFullYear() + 1);
    else end.setMonth(end.getMonth() + 1);

    await supabaseAdmin
      .from("premium_payments")
      .update({
        payment_status: "paid",
        paid_at: start.toISOString(),
        period_start: start.toISOString(),
        period_end: end.toISOString(),
      })
      .eq("id", data.paymentId);

    if (pay.plan_tier !== "payg") {
      await supabaseAdmin
        .from("profiles")
        .update({
          plan_tier: pay.plan_tier,
          plan_expires_at: end.toISOString(),
        })
        .eq("id", pay.user_id);

      await supabaseAdmin.from("user_subscriptions").insert({
        user_id: pay.user_id,
        plan_tier: pay.plan_tier,
        status: "active",
        expires_at: end.toISOString(),
        notes: `premium_payment:${pay.id}`,
      });
    }

    return { ok: true as const, expiresAt: end.toISOString() };
  });


/** Monthly PAYG settlement order (PromptPay) — admin confirms like Premium */
export const createPaygOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const settings = await loadBillingSettings();
    if (!settings.paygEnabled) throw new Error("PAYG is disabled");
    if (!settings.promptpayId) throw new Error("ยังไม่ได้ตั้ง PromptPay");
    if (await isPremiumActive(context.userId)) {
      return { amount: 0, paymentId: null as string | null, message: "premium_skip" as const };
    }
    const ym = yearMonthBangkok();
    // Previous month usage overage — simplified: charge total_count over freeTotal * unit
    const supabaseAdmin = await admin();
    const { data: usage } = await supabaseAdmin
      .from("ai_usage_monthly")
      .select("*")
      .eq("user_id", context.userId)
      .eq("year_month", ym)
      .maybeSingle();
    const total = Number((usage as Record<string, unknown> | null)?.["total_count"] ?? 0);
    const over = Math.max(0, total - settings.freeTotal);
    const amountBaht = (over * settings.paygUnitSatang) / 100;
    if (amountBaht <= 0) {
      return { amount: 0, paymentId: null as string | null, message: "no_overage" as const };
    }
    const { data: row, error } = await supabaseAdmin
      .from("premium_payments")
      .insert({
        user_id: context.userId,
        plan_tier: "payg",
        period: "monthly",
        amount: amountBaht,
        payment_status: "draft",
        promptpay_id: settings.promptpayId,
      } as never)
      .select("id, amount, promptpay_id")
      .single();
    if (error) throw new Error(error.message);
    const amt = Number(row.amount);
    return {
      paymentId: row.id as string,
      amount: amt,
      promptpayId: row.promptpay_id as string,
      qrUrl: `https://promptpay.io/${row.promptpay_id}/${amt.toFixed(2)}`,
      message: "ok" as const,
    };
  });


/** User: list own premium / family / PAYG payments (not pure draft without report optional: show draft+pending+paid) */
export const listMyPremiumPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await admin();
    const { data, error } = await supabaseAdmin
      .from("premium_payments")
      .select("id, plan_tier, period, amount, payment_status, payer_ref, created_at, paid_at")
      .eq("user_id", context.userId)
      .in("payment_status", ["pending", "paid", "rejected"])
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    // Hide pure draft with no payer_ref older than display? Show all for transparency after create
    return { items: data ?? [] };
  });
