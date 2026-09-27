import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin, requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const JobId = z.object({ jobId: z.string().uuid() });

/**
 * The few facts a money notification has to name: which job, whose, how much.
 *
 * Read once per notification rather than threaded through payment.server,
 * whose return shapes differ per call and none of which carries the helper's
 * name. Failures come back empty - noticeBody drops empty details, so a card
 * loses a row instead of the notification being lost.
 */
async function jobFacts(
  jobId: string,
): Promise<{ title: string; agreedPrice: number | null; helperName: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("title, agreed_price, assigned_helper_id")
      .eq("id", jobId)
      .maybeSingle();
    let helperName = "";
    if (job?.assigned_helper_id) {
      const { data: helper } = await supabaseAdmin
        .from("helper_profiles")
        .select("user_id, display_name")
        .eq("id", job.assigned_helper_id as string)
        .maybeSingle();
      helperName = (helper?.display_name as string | null)?.trim() || "";
      if (!helperName && helper?.user_id) {
        const { userLabel } = await import("./family-labels.server");
        helperName = await userLabel(helper.user_id as string);
      }
    }
    return {
      title: (job?.title as string | null) ?? "",
      agreedPrice: (job?.agreed_price as number | null) ?? null,
      helperName,
    };
  } catch {
    return { title: "", agreedPrice: null, helperName: "" };
  }
}

/** Job owner creates a pending payment + returns PromptPay QR payload. */
export const createJobPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobId.parse(input))
  .handler(async ({ data, context }) => {
    const { createPendingJobPayment } = await import("./payment.server");
    return createPendingJobPayment(context.supabase, context.userId, data.jobId);
  });

/** Job owner attaches transfer ref while still pending. */
export const submitPaymentRef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ jobId: z.string().uuid(), payerRef: z.string().trim().max(40) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { submitPayerRef } = await import("./payment.server");
    const res = await submitPayerRef(context.supabase, context.userId, data.jobId, data.payerRef);
    const { notifyAdmins } = await import("./notify.server");
    const job = await jobFacts(data.jobId);
    const { userLabel } = await import("./family-labels.server");
    const { bahtTH, noticeBody } = await import("./notice-detail");
    await notifyAdmins(
      {
        kind: "payment_review",
        title: "มีการแจ้งโอนค่าจ้าง",
        body: noticeBody("รอตรวจสอบและยืนยันยอดที่รับเข้า", [
          ["งาน", job.title],
          ["ผู้ว่าจ้าง", await userLabel(context.userId)],
          ["ยอด", bahtTH(job.agreedPrice)],
          ["อ้างอิงการโอน", data.payerRef],
        ]),
        href: "/admin/payments",
        refTable: "jobs",
        refId: data.jobId,
      },
      context.userId,
    );
    return res;
  });

/** Job owner confirms service received → released + payout queue. */
export const verifyJobService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobId.parse(input))
  .handler(async ({ data, context }) => {
    const { verifyServiceByPayer } = await import("./payment.server");
    const res = await verifyServiceByPayer(context.supabase, context.userId, data.jobId);
    const { notifyJobParties } = await import("./notify.server");
    const verified = await jobFacts(data.jobId);
    const { bahtTH, noticeBody } = await import("./notice-detail");
    await notifyJobParties(
      data.jobId,
      {
        kind: "job_verified",
        title: "ผู้ว่าจ้างยืนยันรับงานแล้ว",
        body: noticeBody("เงินถูกปล่อยเข้าคิวจ่ายให้ผู้รับงาน", [
          ["งาน", verified.title],
          ["ผู้รับงาน", verified.helperName],
          ["ยอดที่ตกลง", bahtTH(verified.agreedPrice)],
        ]),
        href: "/helper-dashboard",
        refTable: "jobs",
        refId: data.jobId,
      },
      context.userId,
    );
    return res;
  });

/** Helper marks service ended. */
export const markServiceEnded = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobId.parse(input))
  .handler(async ({ data, context }) => {
    const { markServiceEndedByHelper } = await import("./payment.server");
    const res = await markServiceEndedByHelper(context.supabase, context.userId, data.jobId);
    const { notifyJobParties } = await import("./notify.server");
    const ended = await jobFacts(data.jobId);
    const { bahtTH, noticeBody } = await import("./notice-detail");
    await notifyJobParties(
      data.jobId,
      {
        kind: "job_ended",
        title: "ผู้รับงานแจ้งว่าทำงานเสร็จแล้ว",
        body: noticeBody("กรุณาตรวจงานและยืนยันเพื่อปล่อยเงิน", [
          ["งาน", ended.title],
          ["ผู้รับงาน", ended.helperName],
          ["ยอดที่ตกลง", bahtTH(ended.agreedPrice)],
        ]),
        href: "/helpme",
        refTable: "jobs",
        refId: data.jobId,
      },
      context.userId,
    );
    return res;
  });

/** Admin: pending → held (money received). */
export const adminConfirmJobPayment = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ paymentId: z.string().uuid(), action: z.enum(["held", "failed"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { adminConfirmHeld, adminMarkFailed } = await import("./payment.server");
    if (data.action === "held") return adminConfirmHeld(data.paymentId, context.userId);
    return adminMarkFailed(data.paymentId, context.userId);
  });

/** Admin: released + payout pending → paid. */
export const adminCompletePayout = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({ paymentId: z.string().uuid(), notes: z.string().trim().max(500).optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { adminMarkPayoutPaid } = await import("./payment.server");
    return adminMarkPayoutPaid(data.paymentId, undefined, data.notes);
  });

/** Admin lists: pending verify, held, payout queue. */
export const listJobPaymentQueues = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { listPaymentQueues } = await import("./payment.server");
    return listPaymentQueues();
  });
