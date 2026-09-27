import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * The numbers the pre-login page quotes.
 *
 * They live in platform_settings, which an admin edits, but that table is
 * readable only by `authenticated` - and rightly, since it also holds the
 * PromptPay id and the cost factors. A visitor who has not signed up yet still
 * has to be told the truth about the price, so this returns the handful of
 * fields that are already public knowledge and nothing else.
 *
 * No auth middleware on purpose: the landing page has no session.
 */
export type PublicPricing = {
  freeChat: number;
  freeDocument: number;
  freeDecision: number;
  freeTranscribe: number;
  freeTotal: number;
  paygEnabled: boolean;
  paygSatang: number;
  premiumMonthly: number;
  premiumYearly: number;
  familyMonthly: number;
  familyYearly: number;
};

/** What the page shows if the row or the columns are not there yet. */
const FALLBACK: PublicPricing = {
  freeChat: 40,
  freeDocument: 12,
  freeDecision: 8,
  freeTranscribe: 15,
  freeTotal: 60,
  paygEnabled: false,
  paygSatang: 50,
  premiumMonthly: 89,
  premiumYearly: 890,
  familyMonthly: 149,
  familyYearly: 1490,
};

const n = (v: unknown, fallback: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

export const getPublicPricing = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicPricing> => {
    // select * like loadBillingSettings: these columns arrived by migration and
    // are not in the generated types, and naming them would make the whole
    // select fail on a database that has not caught up yet.
    const { data, error } = await supabaseAdmin.from("platform_settings").select("*").maybeSingle();
    // A landing page that fails to render because a settings column is missing
    // is worse than one quoting the defaults those columns were created with.
    if (error || !data) return FALLBACK;
    const d = data as unknown as Record<string, unknown>;
    return {
      freeChat: n(d["free_chat_limit"], FALLBACK.freeChat),
      freeDocument: n(d["free_document_limit"], FALLBACK.freeDocument),
      freeDecision: n(d["free_decision_limit"], FALLBACK.freeDecision),
      freeTranscribe: n(d["free_transcribe_limit"], FALLBACK.freeTranscribe),
      freeTotal: n(d["free_total_ai_limit"], FALLBACK.freeTotal),
      paygEnabled: d["payg_enabled"] === true,
      paygSatang: n(d["payg_unit_price_satang"], FALLBACK.paygSatang),
      premiumMonthly: n(d["premium_price_monthly"], FALLBACK.premiumMonthly),
      premiumYearly: n(d["premium_price_yearly"], FALLBACK.premiumYearly),
      familyMonthly: n(d["family_price_monthly"], FALLBACK.familyMonthly),
      familyYearly: n(d["family_price_yearly"], FALLBACK.familyYearly),
    };
  },
);
