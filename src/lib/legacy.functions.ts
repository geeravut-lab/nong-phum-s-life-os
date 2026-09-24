import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const legacyAssist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        message: z.string().min(3).max(4000),
        lang: z.enum(["th", "en"]).default("th"),
        contextHint: z.string().max(3000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { extractLegacyFromText } = await import("./legacy.server");
    return extractLegacyFromText({
      message: data.message,
      lang: data.lang,
      ...(data.contextHint ? { contextHint: data.contextHint } : {}),
    });
  });
