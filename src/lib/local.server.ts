import { generateObject } from "ai";
import { z } from "zod";
import { persona } from "./ai-gateway.server";
import { withProviderFallback } from "./ai-provider.server";
import { langName as langNameFor } from "./i18n.dict";
import { PLACE_CATEGORIES, type LocalSearchIntent } from "./local.shared";

const IntentSchema = z.object({
  categories: z.array(z.enum(PLACE_CATEGORIES)).max(5),
  tags: z.array(z.string()).max(8),
  budgetMax: z.number().nullable(),
  areaHint: z.string().nullable(),
  withKids: z.boolean(),
  openEvening: z.boolean(),
  querySummary: z.string(),
});

export async function parseLocalSearchIntent(input: {
  query: string;
  lang: "th" | "en";
}): Promise<LocalSearchIntent> {
  const langName = langNameFor(input.lang);
  const { object } = await withProviderFallback("chat", (model) =>
    generateObject({
      model,
      schema: IntentSchema,
      system: `${persona(input.lang)}
Parse a natural-language local search in Thailand into structured filters.
Categories must be from the enum. budgetMax in THB if mentioned, else null.
tags: short english keywords like kids, outdoor, night, cafe.
Free-text querySummary in ${langName}.`,
      prompt: input.query,
    }),
  );
  return object;
}
