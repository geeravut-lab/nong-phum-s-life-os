import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Reading the automation rules the tick runs.
 *
 * The rule's condition stays in typed code; what lives in the database is
 * whether it runs and the numbers inside it. So this is deliberately small: a
 * lookup, a number getter with a fallback, and a place to record what the last
 * run did.
 *
 * The fallback matters. If the rules table cannot be read - a bad deploy, a
 * migration not yet applied - every rule runs with the value it was hardcoded
 * with rather than not running at all. A reminder engine that goes silent
 * because a settings table is missing would be a worse failure than one that
 * ignores an admin's tuning for an hour.
 */

export type RuleRow = {
  key: string;
  enabled: boolean;
  params: Record<string, unknown>;
};

export type RuleSet = Map<string, RuleRow>;

export async function loadRules(): Promise<RuleSet> {
  const map: RuleSet = new Map();
  try {
    const { data, error } = await supabaseAdmin
      .from("automation_rules")
      .select("key, enabled, params")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    for (const r of data ?? []) {
      map.set(r.key as string, {
        key: r.key as string,
        enabled: !!r.enabled,
        params: (r.params ?? {}) as Record<string, unknown>,
      });
    }
  } catch (err) {
    console.warn(
      "[rules] could not load, using code defaults:",
      err instanceof Error ? err.message : err,
    );
  }
  return map;
}

/** A rule with no row is on: a new rule ships working, not switched off. */
export function ruleEnabled(rules: RuleSet, key: string): boolean {
  const r = rules.get(key);
  return r ? r.enabled : true;
}

/** A number from the rule's params, or the value the code was written with. */
export function ruleNumber(rules: RuleSet, key: string, param: string, fallback: number): number {
  const raw = rules.get(key)?.params?.[param];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** What the last run did, so a rule that has quietly stopped is visible. */
export async function recordRuleRun(key: string, count: number): Promise<void> {
  try {
    await supabaseAdmin
      .from("automation_rules")
      .update({ last_run_at: new Date().toISOString(), last_count: count })
      .eq("key", key);
  } catch {
    // The rule did its work; failing to write the statistic is not worth an error.
  }
}
