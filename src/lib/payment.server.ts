import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Db = SupabaseClient<any, "public", any>;

async function loadSettings() {
  const { data } = await supabaseAdmin.from("platform_settings").select("*").maybeSingle();
  return data;
}

export async function createPendingJobPayment(supabase: Db, userId: string, jobId: string) {
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, user_id, status, agreed_price, platform_fee, assigned_helper_id")
    .eq("id", jobId)
    .single();
  if (jobErr || !job) throw new Error(jobErr?.message ?? "job not found");
  if (job.user_id !== userId) throw new Error("Forbidden");
  if (!["matched", "in_progress"].includes(job.status)) {
    throw new Error("Job is not in a payable state");
  }
  if (job.agreed_price == null) throw new Error("No agreed price");

  const settings = await loadSettings();
  if (settings && settings.escrow_enabled === false) {
    throw new Error("Escrow is disabled");
  }

  const price = Number(job.agreed_price);
  const fee =
    job.platform_fee != null
      ? Number(job.platform_fee)
      : settings?.revenue_mode === "service_fee"
        ? Number(settings?.service_fee ?? 0)
        : Math.round((price * Number(settings?.commission_rate ?? 5)) / 100);
  const payAmount = settings?.revenue_mode === "service_fee" ? price + fee : price;
  const platformFee = fee;
  const providerAmount =
    settings?.revenue_mode === "service_fee" ? price : Math.max(0, price - fee);

  const promptpayId = settings?.helpme_promptpay_id ?? null;
  const cancelFeePct = Number(settings?.cancel_fee_pct ?? 20);

  const { data: existing } = await supabase
    .from("job_payments")
    .select("id, payment_status, amount")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existing && existing.payment_status !== "failed") {
    const amt = Number(existing.amount);
    return {
      paymentId: existing.id,
      amount: amt,
      promptpayId,
      qrUrl: promptpayId ? `https://promptpay.io/${promptpayId}/${amt.toFixed(2)}` : null,
      alreadyExists: true as const,
    };
  }

  const { data: row, error } = await supabase
    .from("job_payments")
    .insert({
      job_id: jobId,
      payer_id: userId,
      helper_id: job.assigned_helper_id,
      amount: payAmount,
      platform_fee: platformFee,
      provider_amount: providerAmount,
      payment_status: "pending",
      cancel_fee_pct: cancelFeePct,
      promptpay_id: promptpayId,
    })
    .select("id, amount")
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("jobs").update({ payment_status: "pending" }).eq("id", jobId);

  const amt = Number(row.amount);
  return {
    paymentId: row.id,
    amount: amt,
    promptpayId,
    qrUrl: promptpayId ? `https://promptpay.io/${promptpayId}/${amt.toFixed(2)}` : null,
    alreadyExists: false as const,
  };
}

export async function submitPayerRef(
  supabase: Db,
  userId: string,
  jobId: string,
  payerRef: string,
) {
  const { data, error } = await supabase
    .from("job_payments")
    .update({ payer_ref: payerRef })
    .eq("job_id", jobId)
    .eq("payer_id", userId)
    .eq("payment_status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No pending payment");
  return { ok: true as const };
}

export async function verifyServiceByPayer(_supabase: Db, userId: string, jobId: string) {
  const { data: pay, error } = await supabaseAdmin
    .from("job_payments")
    .select("*")
    .eq("job_id", jobId)
    .eq("payer_id", userId)
    .maybeSingle();
  if (error || !pay) throw new Error(error?.message ?? "payment not found");
  if (pay.payment_status !== "held") {
    throw new Error("Payment must be held before verify");
  }

  const { error: upErr } = await supabaseAdmin
    .from("job_payments")
    .update({
      payment_status: "released",
      payout_status: "pending",
      verified_at: new Date().toISOString(),
      released_at: new Date().toISOString(),
    })
    .eq("id", pay.id)
    .eq("payment_status", "held");
  if (upErr) throw new Error(upErr.message);

  await supabaseAdmin
    .from("jobs")
    .update({ payment_status: "released", status: "done" })
    .eq("id", jobId);
  return { ok: true as const };
}

export async function markServiceEndedByHelper(supabase: Db, userId: string, jobId: string) {
  const { data: profile } = await supabase
    .from("helper_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) throw new Error("Not a helper");

  const { data, error } = await supabase
    .from("job_payments")
    .update({ service_ended: true })
    .eq("job_id", jobId)
    .eq("helper_id", profile.id)
    .in("payment_status", ["held", "released"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No payment to update");
  return { ok: true as const };
}

export async function adminConfirmHeld(paymentId: string, adminId: string) {
  const { data, error } = await supabaseAdmin
    .from("job_payments")
    .update({
      payment_status: "held",
      paid_at: new Date().toISOString(),
      confirmed_by: adminId,
    })
    .eq("id", paymentId)
    .eq("payment_status", "pending")
    .select("job_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Payment not pending");
  await supabaseAdmin.from("jobs").update({ payment_status: "held" }).eq("id", data.job_id);
  return { ok: true as const };
}

export async function adminMarkFailed(paymentId: string, adminId: string) {
  const { data, error } = await supabaseAdmin
    .from("job_payments")
    .update({
      payment_status: "failed",
      confirmed_by: adminId,
      notes: "marked failed by admin",
    })
    .eq("id", paymentId)
    .eq("payment_status", "pending")
    .select("job_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Payment not pending");
  await supabaseAdmin.from("jobs").update({ payment_status: "failed" }).eq("id", data.job_id);
  return { ok: true as const };
}

export async function adminMarkPayoutPaid(paymentId: string, slipPath?: string, notes?: string) {
  const { data, error } = await supabaseAdmin
    .from("job_payments")
    .update({
      payout_status: "paid",
      payout_paid_at: new Date().toISOString(),
      payout_slip_path: slipPath ?? null,
      notes: notes ?? null,
    })
    .eq("id", paymentId)
    .eq("payment_status", "released")
    .eq("payout_status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not in payout queue");
  return { ok: true as const };
}

export async function listPaymentQueues() {
  const { data: rows, error } = await supabaseAdmin
    .from("job_payments")
    .select(
      "id, job_id, payer_id, helper_id, amount, platform_fee, provider_amount, payment_status, payout_status, service_ended, payer_ref, promptpay_id, paid_at, verified_at, created_at, jobs(title, scheduled_at, status)",
    )
    .in("payment_status", ["pending", "held", "released", "partial-refunded"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const list = rows ?? [];
  return {
    pending: list.filter((r) => r.payment_status === "pending"),
    held: list.filter((r) => r.payment_status === "held"),
    payout: list.filter((r) => r.payment_status === "released" && r.payout_status === "pending"),
    partialRefunded: list.filter((r) => r.payment_status === "partial-refunded"),
  };
}

/** Auto-cancel held payments past scheduled_at + 1h without verify (INVITED_ESCROW). */
export async function autoCancelHeldPayments(now: Date): Promise<number> {
  const cutoffMs = now.getTime() - 60 * 60 * 1000;
  const { data: candidates, error } = await supabaseAdmin
    .from("job_payments")
    .select("id, job_id, jobs!inner(scheduled_at, status)")
    .eq("payment_status", "held")
    .is("verified_at", null)
    .limit(50);
  if (error) throw new Error(`auto-cancel select: ${error.message}`);

  let n = 0;
  for (const row of candidates ?? []) {
    const job = row.jobs as unknown as { scheduled_at: string | null; status: string } | null;
    if (!job?.scheduled_at) continue;
    if (new Date(job.scheduled_at).getTime() > cutoffMs) continue;

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("job_payments")
      .update({
        payment_status: "partial-refunded",
        payout_status: "pending",
        notes: "auto-cancel: past scheduled window without verify",
      })
      .eq("id", row.id)
      .eq("payment_status", "held")
      .is("verified_at", null)
      .select("id")
      .maybeSingle();
    if (upErr) {
      console.error(`[tick] auto-cancel payment ${row.id}: ${upErr.message}`);
      continue;
    }
    if (!updated) continue;

    await supabaseAdmin
      .from("jobs")
      .update({ payment_status: "partial-refunded", status: "cancelled" })
      .eq("id", row.job_id);
    n += 1;
  }
  return n;
}
