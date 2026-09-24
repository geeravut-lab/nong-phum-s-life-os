import { generateObject } from "ai";
import { persona } from "./ai-gateway.server";
import { withProviderFallback } from "./ai-provider.server";
import { langName as langNameFor } from "./i18n.dict";
import { BoardSchema, type DecisionBoard } from "./decision.shared";

export type { DecisionBoard };
export { DECISION_TEMPLATES, scoreOption } from "./decision.shared";

export async function buildDecisionBoard(input: {
  question: string;
  template?: string | null;
  context?: Record<string, string>;
  lang: "th" | "en";
}): Promise<DecisionBoard> {
  const langName = langNameFor(input.lang);
  const ctxEntries = Object.entries(input.context ?? {}).filter(([, v]) => v?.trim());
  const ctxBlock =
    ctxEntries.length > 0
      ? ctxEntries.map(([k, v]) => `- ${k}: ${v}`).join("\n")
      : "(no extra answers yet)";

  const { object } = await withProviderFallback("reasoning", (model) =>
    generateObject({
      model,
      schema: BoardSchema,
      system: `${persona(input.lang)}
You build a DECISION BOARD — not a chatbot reply.
Rules:
- Never decide for the user as absolute truth; lean with confidence % and uncertainties.
- Separate facts vs judgments.
- Criteria weights 1–5; option scores 1–5 per criterion.
- If critical context is missing, set needsMoreInfo=true and ask up to 4 short follow-up questions (ids like q1,q2). Still fill a best-effort board if possible.
- Use Thailand-relevant costs/context when helpful. Free text in ${langName}.
- Template hint: ${input.template ?? "other"}`,
      prompt: `Decision question: ${input.question}

User context answers:
${ctxBlock}`,
    }),
  );

  return object;
}
