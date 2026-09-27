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

/**
 * Test a saved decision against a change in circumstances.
 *
 * Reads the board back from the row rather than taking it from the client: the
 * whole point is to test the decision the user actually saved, and a board
 * posted from the browser could be anything.
 */
export const runDecisionScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        decisionId: z.string().uuid(),
        change: z.string().min(3).max(500),
        lang: LangInput,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const quota = (await checkAndConsumeAiQuota({ data: { task: "decision" } })) as {
      allowed: boolean;
      message?: string;
    };
    if (!quota.allowed) throw new Error(quota.message ?? "app:quota_exhausted");

    const { data: row, error } = await context.supabase
      .from("decisions")
      .select("id, user_id, question, board, scenarios")
      .eq("id", data.decisionId)
      .single();
    if (error || !row) throw new Error(error?.message ?? "not found");
    if (row.user_id !== context.userId) throw new Error("Forbidden");

    const board = row.board as import("./decision.shared").DecisionBoard;
    if (!board?.options?.length) throw new Error("no board to test");

    const { buildDecisionScenario } = await import("./decision.server");
    const result = await buildDecisionScenario({
      question: row.question as string,
      board,
      change: data.change.trim(),
      lang: data.lang,
    });

    // Kept with the decision, newest last, so it carries its own history of
    // second thoughts. Capped so one decision cannot grow without limit.
    const stored = Array.isArray(row.scenarios) ? (row.scenarios as unknown[]) : [];
    const next = [
      ...stored,
      { question: data.change.trim(), at: new Date().toISOString(), result },
    ].slice(-20);
    await context.supabase
      .from("decisions")
      .update({ scenarios: next as never })
      .eq("id", data.decisionId);

    return result;
  });
