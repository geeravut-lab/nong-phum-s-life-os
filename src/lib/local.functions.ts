import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const parseLocalQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        query: z.string().min(2).max(500),
        lang: z.enum(["th", "en"]).default("th"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { parseLocalSearchIntent } = await import("./local.server");
    return parseLocalSearchIntent(data);
  });
