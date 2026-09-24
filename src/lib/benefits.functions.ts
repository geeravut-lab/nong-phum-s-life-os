import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LangInput = z.enum(["th", "en"]).default("th");

export const interviewBenefits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        message: z.string().max(2000).optional().nullable(),
        answers: z.record(z.string(), z.string().max(400)).optional(),
        lang: LangInput,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { interviewBenefitProfile } = await import("./benefits-ai.server");
    return interviewBenefitProfile({
      message: data.message ?? null,
      ...(data.answers ? { answers: data.answers } : {}),
      lang: data.lang,
    });
  });
