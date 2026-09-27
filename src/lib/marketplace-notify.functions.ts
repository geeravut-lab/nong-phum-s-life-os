import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Tell the other side of a job that something happened.
 *
 * Chat and offers are written from the browser with the user's own client, so
 * they cannot write app_notifications for somebody else - RLS stops that, and
 * rightly. These thin server functions do it with the service-role client
 * after checking the caller is actually part of the job.
 */

export const notifyJobChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyJobParties } = await import("./notify.server");

    // Only someone on the job may trigger its notifications.
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("id, title, user_id, assigned_helper_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job) throw new Error("not found");

    let helperUserId: string | null = null;
    if (job.assigned_helper_id) {
      const { data: h } = await supabaseAdmin
        .from("helper_profiles")
        .select("user_id")
        .eq("id", job.assigned_helper_id as string)
        .maybeSingle();
      helperUserId = (h?.user_id as string | null) ?? null;
    }
    if (context.userId !== job.user_id && context.userId !== helperUserId) {
      throw new Error("Forbidden");
    }

    // The message itself, not just the job it belongs to. A card that says
    // only "ข้อความใหม่ในงาน / ซ่อมก๊อกน้ำ" makes the reader open the app to
    // find out whether it needed an answer.
    const { data: last } = await supabaseAdmin
      .from("job_messages")
      .select("body, sender_id, created_at")
      .eq("job_id", data.jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { userLabel } = await import("./family-labels.server");
    const { noticeBody, whenTH } = await import("./notice-detail");
    const from = await userLabel((last?.sender_id as string | null) ?? context.userId);

    const sent = await notifyJobParties(
      data.jobId,
      {
        kind: "job_message",
        title: "ข้อความใหม่ในงาน",
        body: noticeBody((last?.body as string | null) ?? "", [
          ["งาน", (job.title as string) ?? ""],
          ["จาก", from],
          ["เมื่อ", whenTH((last?.created_at as string | null) ?? new Date().toISOString())],
        ]),
        href: "/helpme",
        refTable: "jobs",
        refId: data.jobId,
      },
      context.userId,
    );
    return { sent };
  });

export const notifyJobOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ jobId: z.string().uuid(), event: z.enum(["offered", "accepted", "withdrawn"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyUsers } = await import("./notify.server");

    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("id, title, user_id, location_text, scheduled_at, agreed_price")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job) throw new Error("not found");

    const { userLabel } = await import("./family-labels.server");
    const { bahtTH, noticeBody, whenTH } = await import("./notice-detail");

    // The quote the event is about. "offered" and "withdrawn" come from the
    // helper, so their own latest row is the one that moved; "accepted" comes
    // from the job owner, so the accepted row is.
    const offerQuery = supabaseAdmin
      .from("job_offers")
      .select("price, message, eta_hours, helper_user_id, status, updated_at")
      .eq("job_id", data.jobId)
      .order("updated_at", { ascending: false })
      .limit(1);
    const { data: offer } = await (
      data.event === "accepted"
        ? offerQuery.eq("status", "accepted")
        : offerQuery.eq("helper_user_id", context.userId)
    ).maybeSingle();

    const helperName = await userLabel(
      (offer?.helper_user_id as string | null) ??
        (data.event === "accepted" ? null : context.userId),
    );
    const priceText = bahtTH(offer?.price as number | null);
    const etaText = offer?.eta_hours ? `ประมาณ ${Number(offer.eta_hours)} ชั่วโมง` : "";

    if (data.event === "offered") {
      // A new quote: only the person who posted the job needs to know.
      const sent = await notifyUsers(
        [job.user_id as string],
        {
          kind: "job_offer",
          params: { jobTitle: (job.title as string) ?? "" },
          title: "มีข้อเสนอใหม่",
          body: noticeBody((job.title as string) ?? "", [
            ["ผู้เสนอ", helperName],
            ["ราคาที่เสนอ", priceText],
            ["ใช้เวลา", etaText],
            ["ข้อความ", (offer?.message as string | null) ?? ""],
          ]),
          href: "/helpme",
          refTable: "jobs",
          refId: data.jobId,
        },
        context.userId,
      );
      return { sent };
    }

    if (data.event === "withdrawn") {
      // A quote taken back: the person who posted the job was waiting on it.
      const sent = await notifyUsers(
        [job.user_id as string],
        {
          kind: "job_offer",
          title: "ข้อเสนอถูกถอน",
          body: noticeBody((job.title as string) ?? "", [
            ["ผู้เสนอ", helperName],
            ["ราคาที่เคยเสนอ", priceText],
          ]),
          href: "/helpme",
          refTable: "jobs",
          refId: data.jobId,
        },
        context.userId,
      );
      return { sent };
    }

    // Accepted: the helper needs to know, and only the owner may announce it.
    if (context.userId !== job.user_id) throw new Error("Forbidden");

    // Straight to the accepted offer's helper, not through notifyJobParties.
    // That reads jobs.assigned_helper_id, which the browser writes *after* it
    // calls this - so the lookup found nobody, the only other party was the
    // actor, and the helper was never told their quote had been taken. Their
    // user id is on the offer row we already have, and it is correct whatever
    // order the client writes in.
    const sent = await notifyUsers(
      [(offer?.helper_user_id as string | null) ?? null],
      {
        kind: "job_accepted",
        params: { jobTitle: (job.title as string) ?? "" },
        title: "ข้อเสนอถูกตอบรับ",
        body: noticeBody((job.title as string) ?? "", [
          ["ผู้รับงาน", helperName],
          ["ราคาที่ตกลง", priceText || bahtTH(job.agreed_price as number | null)],
          ["นัดหมาย", whenTH(job.scheduled_at as string | null)],
          ["สถานที่", (job.location_text as string | null) ?? ""],
        ]),
        href: "/helper-dashboard",
        refTable: "jobs",
        refId: data.jobId,
      },
      context.userId,
    );
    return { sent };
  });
