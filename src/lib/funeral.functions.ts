import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const planFuneral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        budget: z.number().nullable().optional(),
        religion: z.string().min(1).max(80),
        province: z.string().min(1).max(80),
        days: z.number().nullable().optional(),
        guests: z.number().nullable().optional(),
        style: z.string().max(120).default(""),
        extras: z.string().max(1000).default(""),
        lang: z.enum(["th", "en"]).default("th"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { buildFuneralPackages } = await import("./funeral.server");
    const packages = await buildFuneralPackages({
      budget: data.budget ?? null,
      religion: data.religion,
      province: data.province,
      days: data.days ?? null,
      guests: data.guests ?? null,
      style: data.style,
      extras: data.extras,
      lang: data.lang,
    });
    const { data: row, error } = await context.supabase
      .from("funeral_plans")
      .insert({
        user_id: context.user.id,
        input: data,
        packages: packages.packages,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { planId: row.id, ...packages };
  });

export const createFuneralPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        packageId: z.enum(["economy", "standard", "premium"]),
        installments: z.union([z.literal(1), z.literal(12), z.literal(24), z.literal(36)]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: plan, error } = await context.supabase
      .from("funeral_plans")
      .select("id, user_id, packages, status")
      .eq("id", data.planId)
      .single();
    if (error || !plan) throw new Error(error?.message ?? "plan not found");
    if (plan.user_id !== context.user.id) throw new Error("Forbidden");

    const pkgs = (plan.packages as Array<{ id: string; totalBudget: number }>) ?? [];
    const selected = pkgs.find((p) => p.id === data.packageId);
    if (!selected) throw new Error("Package not found");

    const { data: settings } = await supabaseAdmin
      .from("platform_settings")
      .select("funeral_promptpay_id, helpme_promptpay_id")
      .maybeSingle();
    const promptpayId =
      (settings as { funeral_promptpay_id?: string; helpme_promptpay_id?: string } | null)
        ?.funeral_promptpay_id ??
      (settings as { helpme_promptpay_id?: string } | null)?.helpme_promptpay_id ??
      null;

    let amount = Number(selected.totalBudget);
    if (data.installments > 1) {
      amount = Math.ceil(amount / data.installments);
    }

    await context.supabase
      .from("funeral_plans")
      .update({
        selected_package: data.packageId,
        total_budget: selected.totalBudget,
        status: "selected",
      })
      .eq("id", data.planId);

    const { data: pay, error: payErr } = await context.supabase
      .from("funeral_payments")
      .insert({
        plan_id: data.planId,
        payer_id: context.user.id,
        amount,
        installments: data.installments,
        payment_status: "pending",
        promptpay_id: promptpayId,
      })
      .select("id, amount")
      .single();
    if (payErr) throw new Error(payErr.message);

    const amt = Number(pay.amount);
    return {
      paymentId: pay.id,
      amount: amt,
      promptpayId,
      qrUrl: promptpayId ? `https://promptpay.io/${promptpayId}/${amt.toFixed(2)}` : null,
      installments: data.installments,
    };
  });

export const markFuneralPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ paymentId: z.string().uuid(), payerRef: z.string().max(80).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const isAdmin = await context.supabase.rpc("has_role", {
      _user_id: context.user.id,
      _role: "admin",
    });
    const { data: pay, error } = await context.supabase
      .from("funeral_payments")
      .select("id, plan_id, payer_id, payment_status")
      .eq("id", data.paymentId)
      .single();
    if (error || !pay) throw new Error(error?.message ?? "not found");
    if (pay.payer_id !== context.user.id && !isAdmin.data) throw new Error("Forbidden");

    await context.supabase
      .from("funeral_payments")
      .update({
        payment_status: "paid",
        payer_ref: data.payerRef ?? null,
        paid_at: new Date().toISOString(),
      })
      .eq("id", data.paymentId);
    await context.supabase
      .from("funeral_plans")
      .update({ status: "paid" })
      .eq("id", pay.plan_id);
    return { ok: true };
  });
