import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LangInput = z.enum(["th", "en"]).default("th");

export const draftJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ message: z.string().min(3).max(2000), lang: LangInput }).parse(input),
  )
  .handler(async ({ data }) => {
    const { draftJobFromText } = await import("./marketplace.server");
    return draftJobFromText(data);
  });

export const suggestHelperSkills = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(3).max(2000), lang: LangInput }).parse(input),
  )
  .handler(async ({ data }) => {
    const { draftHelperSkills } = await import("./marketplace.server");
    return draftHelperSkills(data);
  });

export const matchHelpers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { matchHelpersForJob } = await import("./marketplace.server");
    return matchHelpersForJob(context.supabase, data.jobId);
  });
