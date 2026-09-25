import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkAndConsumeAiQuota } from "@/lib/billing.functions";

const LangInput = z.enum(["th", "en"]).default("th");

export const analyzeDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        question: z.string().min(3).max(500),
        template: z.string().max(40).optional().nullable(),
        context: z.record(z.string(), z.string().max(500)).optional(),
        lang: LangInput,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const quota = (await checkAndConsumeAiQuota({ data: { task: "decision" } })) as {
      allowed: boolean;
      message?: string;
    };
    if (!quota.allowed) throw new Error(quota.message ?? "AI quota exceeded");
    const { buildDecisionBoard } = await import("./decision.server");
    return buildDecisionBoard({
      question: data.question,
      template: data.template ?? null,
      ...(data.context ? { context: data.context } : {}),
      lang: data.lang,
    });
  });
