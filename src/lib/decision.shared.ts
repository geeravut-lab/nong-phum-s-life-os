import { z } from "zod";

export const DECISION_TEMPLATES = [
  "buy_vehicle",
  "buy_rent_home",
  "job_change",
  "insurance",
  "phone",
  "travel",
  "study",
  "business",
  "other",
] as const;

export type DecisionTemplate = (typeof DECISION_TEMPLATES)[number];

export const CriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  weight: z.number().min(1).max(5),
});

export const OptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  pros: z.array(z.string()).max(6),
  cons: z.array(z.string()).max(6),
  risks: z.array(z.string()).max(4),
  scores: z.record(z.string(), z.number().min(1).max(5)),
});

export const BoardSchema = z.object({
  needsMoreInfo: z.boolean(),
  followUpQuestions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        hint: z.string().optional(),
      }),
    )
    .max(5),
  criteria: z.array(CriterionSchema).min(3).max(8),
  options: z.array(OptionSchema).min(2).max(5),
  recommendation: z.object({
    optionId: z.string(),
    leaning: z.string(),
    confidence: z.number().min(0).max(100),
    reasoning: z.string(),
    uncertainties: z.array(z.string()).max(4),
  }),
  factsVsJudgment: z.object({
    facts: z.array(z.string()).max(6),
    judgments: z.array(z.string()).max(6),
  }),
});

export type DecisionBoard = z.infer<typeof BoardSchema>;

/** Weighted total 0–100 for an option. */
export function scoreOption(
  option: DecisionBoard["options"][number],
  criteria: DecisionBoard["criteria"],
): number {
  let weighted = 0;
  let totalW = 0;
  for (const c of criteria) {
    const s = option.scores[c.id] ?? 3;
    weighted += s * c.weight;
    totalW += 5 * c.weight;
  }
  if (totalW <= 0) return 0;
  return Math.round((weighted / totalW) * 100);
}
