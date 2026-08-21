import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AnalyzeInput = z.object({
  base64: z.string().min(1),
  mimeType: z.string().min(1),
  fileName: z.string().default("document"),
  lang: z.enum(["th", "en"]).default("th"),
});

const ChatInput = z.object({
  message: z.string().min(1).max(4000),
  lang: z.enum(["th", "en"]).default("th"),
});

const BriefInput = z.object({ lang: z.enum(["th", "en"]).default("th") });

export const analyzeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AnalyzeInput.parse(input))
  .handler(async ({ data }) => {
    const { runDocumentAnalysis } = await import("./phum.server");
    return runDocumentAnalysis(data);
  });

export const chatWithPhum = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ChatInput.parse(input))
  .handler(async ({ data, context }) => {
    const { runChatRouter } = await import("./phum.server");
    return runChatRouter(data, context.supabase, context.userId);
  });

export const generateDailyBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BriefInput.parse(input))
  .handler(async ({ data, context }) => {
    const { runDailyBrief } = await import("./phum.server");
    return runDailyBrief(data.lang, context.supabase, context.userId);
  });
