import { generateObject } from "ai";
import { z } from "zod";
import { persona } from "./ai-gateway.server";
import { withProviderFallback } from "./ai-provider.server";
import { langName as langNameFor } from "./i18n.dict";
import { ASSET_KINDS } from "./legacy.shared";

const ExtractSchema = z.object({
  summary: z.string(),
  assets: z
    .array(
      z.object({
        kind: z.enum(ASSET_KINDS),
        title: z.string(),
        details: z.string(),
        is_liability: z.boolean(),
        beneficiary_hint: z.string().nullable(),
      }),
    )
    .max(12),
  wishes: z
    .array(
      z.object({
        section: z.enum([
          "final_wishes",
          "funeral_pref",
          "life_story",
          "legacy_message",
          "will_ref",
          "vault_note",
        ]),
        title: z.string(),
        body: z.string(),
      }),
    )
    .max(8),
  checklist: z.array(z.string()).max(8),
  followUpQuestions: z.array(z.string()).max(4),
});

export type LegacyExtract = z.infer<typeof ExtractSchema>;

export async function extractLegacyFromText(input: {
  message: string;
  lang: "th" | "en";
  contextHint?: string;
}): Promise<LegacyExtract> {
  const langName = langNameFor(input.lang);
  const { object } = await withProviderFallback("chat", (model) =>
    generateObject({
      model,
      schema: ExtractSchema,
      system: `${persona(input.lang)}
You help the user prepare a LIFE LEGACY plan (while they are alive).
Extract structured draft items from free text. Do NOT invent account numbers or legal conclusions.
Never claim to create a formal will — will_ref is only "where the real will is kept".
Free text in ${langName}.`,
      prompt: `User message:
${input.message}

Optional LIFE OS context:
${input.contextHint ?? "(none)"}`,
    }),
  );
  return object;
}
