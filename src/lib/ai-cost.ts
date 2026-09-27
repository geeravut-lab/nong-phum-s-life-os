/**
 * What a million tokens costs, per model.
 *
 * Published list prices, checked 2026-09-26. They change, and a wrong number
 * here is worse than no number - so a model that is not in this table is
 * reported with its token counts and no cost, rather than being priced by a
 * guess. Update this table when a vendor changes its pricing; nothing else
 * reads the vendor's site.
 */
export const MODEL_PRICES_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 4, output: 20 },
  // Introductory pricing; doubles to 1.5 / 7.5 on 1 January 2027.
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
};

/** Bank rate is not the point; this is for reading a bill in familiar units. */
export const USD_TO_THB = 33.3;

export function estimateCostThb(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = MODEL_PRICES_USD[model];
  if (!price) return null;
  const usd = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  return usd * USD_TO_THB;
}
