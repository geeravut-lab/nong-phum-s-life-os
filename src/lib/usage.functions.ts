import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { estimateCostThb } from "@/lib/ai-cost";

/**
 * Usage stats for the admin dashboard.
 *
 * All the counting is done in SQL: the table holds one row per user per day per
 * path, and at a few hundred users that is still tens of thousands of rows a
 * month - far too many to pull into the browser to add up. The aggregate
 * functions are granted to service_role only, so this is the one way in, and
 * requireAdmin is what stands in front of it.
 */

export type UsageStats = {
  /** Distinct users active in the last 1 / 7 / 30 days. */
  dau: number;
  wau: number;
  mau: number;
  /** Busiest paths in the window, most views first. */
  topPaths: Array<{ path: string; views: number; users: number }>;
  /** One entry per day in the window, oldest first. */
  daily: Array<{ day: string; views: number; users: number }>;
  /** Total views and the window they cover. */
  totalViews: number;
  days: number;
};

export const getUsageStats = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ days: z.number().int().min(1).max(365).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<UsageStats> => {
    const days = data.days ?? 30;

    const [dau, wau, mau, top, daily] = await Promise.all([
      supabaseAdmin.rpc("usage_active_users", { p_days: 1 }),
      supabaseAdmin.rpc("usage_active_users", { p_days: 7 }),
      supabaseAdmin.rpc("usage_active_users", { p_days: 30 }),
      supabaseAdmin.rpc("usage_top_paths", { p_days: days, p_limit: 25 }),
      supabaseAdmin.rpc("usage_daily_totals", { p_days: days }),
    ]);

    for (const r of [dau, wau, mau, top, daily]) {
      if (r.error) throw new Error(r.error.message);
    }

    const topPaths = (top.data ?? []).map((r) => ({
      path: r.path,
      views: Number(r.views),
      users: Number(r.users),
    }));
    const dailyRows = (daily.data ?? []).map((r) => ({
      day: r.day,
      views: Number(r.views),
      users: Number(r.users),
    }));

    return {
      dau: Number(dau.data ?? 0),
      wau: Number(wau.data ?? 0),
      mau: Number(mau.data ?? 0),
      topPaths,
      daily: dailyRows,
      totalViews: dailyRows.reduce((n, r) => n + r.views, 0),
      days,
    };
  });

export type AiCostRow = {
  task: string;
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when the model is not in the price table - a token count is still useful. */
  costThb: number | null;
  costPerCallThb: number | null;
};

/**
 * What the AI actually cost, from recorded tokens rather than an estimate of
 * the prompt sizes. This is the number the pricing review had to guess at.
 */
export const getAiCostStats = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ days: z.number().int().min(1).max(365).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const days = data.days ?? 30;
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const { data: rows, error } = await supabaseAdmin
      .from("ai_token_usage")
      .select("task, provider, model, calls, input_tokens, output_tokens")
      .gte("day", since);
    if (error) throw new Error(error.message);

    // Several days of the same model collapse into one line: the question is
    // "what does a decide call cost", not "what did it cost last Tuesday".
    const byKey = new Map<string, AiCostRow>();
    for (const r of rows ?? []) {
      const key = `${r.task}|${r.provider}|${r.model}`;
      const cur = byKey.get(key) ?? {
        task: r.task,
        provider: r.provider,
        model: r.model,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costThb: 0,
        costPerCallThb: 0,
      };
      cur.calls += Number(r.calls);
      cur.inputTokens += Number(r.input_tokens);
      cur.outputTokens += Number(r.output_tokens);
      byKey.set(key, cur);
    }

    const list = [...byKey.values()].map((r) => {
      const cost = estimateCostThb(r.model, r.inputTokens, r.outputTokens);
      return {
        ...r,
        costThb: cost,
        costPerCallThb: cost != null && r.calls > 0 ? cost / r.calls : null,
      };
    });
    list.sort((a, b) => (b.costThb ?? 0) - (a.costThb ?? 0) || b.calls - a.calls);

    return {
      days,
      rows: list,
      totalCalls: list.reduce((n, r) => n + r.calls, 0),
      totalCostThb: list.reduce((n, r) => n + (r.costThb ?? 0), 0),
      /** True when something ran on a model with no published price in the table. */
      hasUnpriced: list.some((r) => r.costThb == null),
    };
  });
