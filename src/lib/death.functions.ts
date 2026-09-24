import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Report a death case for subjectUserId (deterministic; no AI). */
export const reportDeathCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        subjectUserId: z.string().uuid(),
        note: z.string().max(2000).default(""),
        requiredConfirmations: z.number().int().min(2).max(5).default(2),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.user.id;
    // Reporter should be admin OR listed as verifier contact for subject
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: uid,
      _role: "admin",
    });
    if (!isAdmin) {
      const { data: contacts } = await context.supabase
        .from("legacy_contacts")
        .select("id, is_verifier, phone, email, full_name")
        .eq("user_id", data.subjectUserId)
        .eq("is_verifier", true);
      if (!contacts?.length) {
        throw new Error("Not authorized: no verifier contacts for this user");
      }
      // Soft check: any signed-in user who claims to be a verifier can report;
      // multi-confirmation still required before status=confirmed.
    }

    const { data: existing } = await context.supabase
      .from("death_cases")
      .select("id, status")
      .eq("subject_user_id", data.subjectUserId)
      .maybeSingle();
    if (existing) {
      return { caseId: existing.id, status: existing.status, alreadyExists: true as const };
    }

    const { data: row, error } = await context.supabase
      .from("death_cases")
      .insert({
        subject_user_id: data.subjectUserId,
        reported_by: uid,
        report_note: data.note,
        required_confirmations: data.requiredConfirmations,
        status: "pending",
      })
      .select("id, status")
      .single();
    if (error) throw new Error(error.message);
    return { caseId: row.id, status: row.status, alreadyExists: false as const };
  });

export const confirmDeathCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        decision: z.enum(["confirm", "reject"]),
        confirmerName: z.string().min(1).max(120),
        note: z.string().max(1000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: c, error } = await context.supabase
      .from("death_cases")
      .select("id, status, subject_user_id, required_confirmations, confirmation_count")
      .eq("id", data.caseId)
      .single();
    if (error || !c) throw new Error(error?.message ?? "case not found");
    if (c.status === "cancelled" || c.status === "rejected") {
      throw new Error("Case is closed");
    }

    const { error: insErr } = await context.supabase.from("death_confirmations").insert({
      case_id: data.caseId,
      confirmer_user_id: context.user.id,
      confirmer_name: data.confirmerName,
      decision: data.decision,
      note: data.note,
    });
    if (insErr) throw new Error(insErr.message);

    const { data: updated } = await context.supabase
      .from("death_cases")
      .select("id, status, confirmation_count, required_confirmations, confirmed_at")
      .eq("id", data.caseId)
      .single();
    return updated;
  });
