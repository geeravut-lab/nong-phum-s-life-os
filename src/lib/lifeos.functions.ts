import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { checkAndConsumeAiQuota } from "@/lib/billing.functions";

const AnalyzeInput = z.object({
  base64: z.string().min(1),
  mimeType: z.string().min(1),
  fileName: z.string().default("document"),
  lang: z.enum(["th", "en"]).default("th"),
});

const ChatInput = z.object({
  message: z.string().min(1).max(4000),
  lang: z.enum(["th", "en"]).default("th"),
  focus: z.enum(["tasks", "expenses", "incomes"]).nullish(),
});

const BriefInput = z.object({ lang: z.enum(["th", "en"]).default("th") });

async function requireQuota(task: "chat" | "document" | "decision" | "transcribe") {
  const res = (await checkAndConsumeAiQuota({ data: { task } })) as {
    allowed: boolean;
    message?: string;
  };
  if (!res.allowed) {
    throw new Error(res.message ?? "AI quota exceeded — upgrade Premium or wait next month");
  }
}

export const analyzeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AnalyzeInput.parse(input))
  .handler(async ({ data }) => {
    await requireQuota("document");
    const { runDocumentAnalysis } = await import("./phum.server");
    return runDocumentAnalysis(data);
  });

export const chatWithPhum = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ChatInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireQuota("chat");
    const { runChatRouter } = await import("./phum.server");
    return runChatRouter(data, context.supabase, context.userId);
  });

export const generateDailyBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BriefInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireQuota("chat");
    const { runDailyBrief } = await import("./phum.server");
    return runDailyBrief(data.lang, context.supabase, context.userId);
  });

export const joinFamilyByCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ code: z.string().trim().min(4).max(32) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: family } = await supabaseAdmin
      .from("families")
      .select("id, name")
      .eq("invite_code", data.code.toUpperCase())
      .maybeSingle();
    if (!family) return { ok: false as const, error: "not_found" };

    const { data: settings } = await supabaseAdmin
      .from("platform_settings")
      .select("*")
      .maybeSingle();
    const maxMembers = Number(
      (settings as Record<string, unknown> | null)?.["family_max_members"] ?? 5,
    );

    const { count } = await supabaseAdmin
      .from("family_members")
      .select("id", { count: "exact", head: true })
      .eq("family_id", family.id);
    if ((count ?? 0) >= maxMembers) {
      return { ok: false as const, error: "family_full" };
    }

    const { error } = await context.supabase
      .from("family_members")
      .insert({ family_id: family.id, user_id: context.userId });
    if (error && !error.message.includes("duplicate")) {
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const, familyId: family.id, name: family.name };
  });

const TranscribeInput = z.object({
  base64: z.string().min(1),
  mimeType: z.string().min(1),
  lang: z.enum(["th", "en"]).default("th"),
});

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TranscribeInput.parse(input))
  .handler(async ({ data }) => {
    await requireQuota("transcribe");
    const { transcribeAudio: run } = await import("./phum.server");
    return run(data);
  });
