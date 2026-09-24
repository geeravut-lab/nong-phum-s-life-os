import { generateObject } from "ai";
import { z } from "zod";
import { persona } from "./ai-gateway.server";
import { withProviderFallback } from "./ai-provider.server";
import { langName as langNameFor } from "./i18n.dict";

const PackageSchema = z.object({
  id: z.enum(["economy", "standard", "premium"]),
  name: z.string(),
  totalBudget: z.number(),
  summary: z.string(),
  lineItems: z
    .array(
      z.object({
        item: z.string(),
        estimate: z.number(),
        note: z.string().optional(),
      }),
    )
    .max(20),
  timeline: z.array(z.string()).max(12),
  providersHint: z.array(z.string()).max(8),
});

const PlanSchema = z.object({
  packages: z.array(PackageSchema).min(3).max(3),
  notes: z.string(),
});

export type FuneralPlanPackages = z.infer<typeof PlanSchema>;

export async function buildFuneralPackages(input: {
  budget: number | null;
  religion: string;
  province: string;
  days: number | null;
  guests: number | null;
  style: string;
  extras: string;
  lang: "th" | "en";
}): Promise<FuneralPlanPackages> {
  const langName = langNameFor(input.lang);
  const { object } = await withProviderFallback("reasoning", (model) =>
    generateObject({
      model,
      schema: PlanSchema,
      system: `${persona(input.lang)}
You are an AI Funeral Planner for Thailand. Produce exactly 3 packages:
economy, standard, premium.
Use realistic THB estimates. Include ceremony, venue, food, flowers, photo/video where relevant.
Do NOT handle legal death verification — planning only.
Free text in ${langName}.`,
      prompt: `Budget THB: ${input.budget ?? "flexible"}
Religion/rite: ${input.religion}
Province: ${input.province}
Days: ${input.days ?? "typical"}
Guests: ${input.guests ?? "unknown"}
Style: ${input.style}
Extras: ${input.extras || "none"}`,
    }),
  );
  return object;
}
