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

    const sent = await notifyJobParties(
      data.jobId,
      {
        kind: "job_message",
        title: "ข้อความใหม่ในงาน",
        body: (job.title as string) ?? "",
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
    z.object({ jobId: z.string().uuid(), event: z.enum(["offered", "accepted"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyUsers, notifyJobParties } = await import("./notify.server");

    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("id, title, user_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job) throw new Error("not found");

    if (data.event === "offered") {
      // A new quote: only the person who posted the job needs to know.
      const sent = await notifyUsers(
        [job.user_id as string],
        {
          kind: "job_offer",
          title: "มีข้อเสนอใหม่",
          body: (job.title as string) ?? "",
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
    const sent = await notifyJobParties(
      data.jobId,
      {
        kind: "job_accepted",
        title: "ข้อเสนอถูกตอบรับ",
        body: (job.title as string) ?? "",
        href: "/helper-dashboard",
        refTable: "jobs",
        refId: data.jobId,
      },
      context.userId,
    );
    return { sent };
  });
