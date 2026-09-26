import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
