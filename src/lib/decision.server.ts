import { generateObject } from "ai";
import { persona } from "./ai-gateway.server";
import { withProviderFallback } from "./ai-provider.server";
import { langName as langNameFor } from "./i18n.dict";
import {
  BoardSchema,
  ScenarioSchema,
  type DecisionBoard,
  type DecisionScenario,
} from "./decision.shared";

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

/**
 * Run a what-if against a board that already exists.
 *
 * Deliberately given the original board rather than the original question: the
 * point is whether *this* recommendation survives the change, so the model has
 * to reason about the same options and criteria the user already saw, not
 * invent a fresh set that cannot be compared with it.
 */
export async function buildDecisionScenario(input: {
  question: string;
  board: DecisionBoard;
  change: string;
  lang: "th" | "en";
}): Promise<DecisionScenario> {
  const langName = langNameFor(input.lang);

  const { object } = await withProviderFallback("reasoning", (model) =>
    generateObject({
      model,
      schema: ScenarioSchema,
      system: `${persona(input.lang)}
You are testing an EXISTING decision board against a change in circumstances.
Rules:
- Reason about the options and criteria you are given. Never invent new options.
- Say plainly whether the recommendation changes, and give the threshold at
  which it would change (flipPoint) in the user's own terms - a number where
  there is one.
- Be honest when the change does not matter: recommendationChanged=false and a
  flipPoint saying how far it would have to go.
- Free text in ${langName}.`,
      prompt: `Decision question: ${input.question}

Existing board:
${JSON.stringify({ criteria: input.board.criteria, options: input.board.options, recommendation: input.board.recommendation })}

What if: ${input.change}`,
    }),
  );

  return object;
}
