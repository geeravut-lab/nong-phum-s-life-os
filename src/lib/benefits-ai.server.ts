import { generateObject } from "ai";
import { z } from "zod";
import { persona } from "./ai-gateway.server";
import { withProviderFallback } from "./ai-provider.server";
import { langName as langNameFor } from "./i18n.dict";
import { BENEFIT_GROUPS } from "./benefits";

const GroupEnum = z.enum([
  "elderly",
  "disabled",
  "low_income",
  "student",
  "farmer",
  "freelance",
  "unemployed",
  "parent",
  "pregnant",
]);

const InterviewSchema = z.object({
  needsMoreInfo: z.boolean(),
  followUpQuestions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
      }),
    )
    .max(4),
  profile: z.object({
    birth_year: z.number().int().min(1920).max(2020).nullable(),
    monthly_income: z.number().min(0).max(1_000_000).nullable(),
    occupation: z.string().max(80).nullable(),
    province: z.string().max(80).nullable(),
    household_size: z.number().int().min(1).max(20).nullable(),
    groups: z.array(GroupEnum).max(8),
    has_social_security: z.boolean().nullable(),
    has_welfare_card: z.boolean().nullable(),
  }),
  summary: z.string().describe("One short sentence summarizing the user's situation"),
});

export type BenefitInterviewResult = z.infer<typeof InterviewSchema>;

export async function interviewBenefitProfile(input: {
  message?: string | null;
  answers?: Record<string, string>;
  lang: "th" | "en";
}): Promise<BenefitInterviewResult> {
  const langName = langNameFor(input.lang);
  const knownGroups = BENEFIT_GROUPS.join(", ");
  const answerBlock =
    Object.entries(input.answers ?? {})
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n") || "(none)";

  const { object } = await withProviderFallback("chat", (model) =>
    generateObject({
      model,
      schema: InterviewSchema,
      system: `${persona(input.lang)}
You interview a Thai resident to fill a government-benefits eligibility profile.
Extract only what is reasonably clear. Use null when unknown.
groups must be from: ${knownGroups}
If income/age/SSO status is missing and important, set needsMoreInfo=true and ask up to 3 short questions.
Free text in ${langName}. Do not invent official benefit amounts.`,
      prompt: `User free text: ${input.message?.trim() || "(empty)"}

Follow-up answers:
${answerBlock}`,
    }),
  );

  return object;
}
