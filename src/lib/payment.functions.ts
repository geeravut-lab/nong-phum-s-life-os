import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin, requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const JobId = z.object({ jobId: z.string().uuid() });

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
    await notifyAdmins(
      {
        kind: "payment_review",
        title: "มีการแจ้งโอนค่าจ้าง",
        body: "รอตรวจสอบและยืนยันยอดที่รับเข้า",
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
    await notifyJobParties(
      data.jobId,
      {
        kind: "job_verified",
        title: "ผู้ว่าจ้างยืนยันรับงานแล้ว",
        body: "เงินถูกปล่อยเข้าคิวจ่ายให้ผู้รับงาน",
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
    await notifyJobParties(
      data.jobId,
      {
        kind: "job_ended",
        title: "ผู้รับงานแจ้งว่าทำงานเสร็จแล้ว",
        body: "กรุณาตรวจงานและยืนยันเพื่อปล่อยเงิน",
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
