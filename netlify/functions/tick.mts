import type { Config } from "@netlify/functions";

// Phase 1.3 step 0: proves that a scheduled function deploys alongside the SSR
// handler that @netlify/vite-plugin-tanstack-start emits into
// .netlify/v1/functions/. It does nothing but log; the cleanup jobs and the
// reminder engine are added once the schedule is confirmed in the Netlify UI.
export default async () => {
  console.info(`[tick] alive at ${new Date().toISOString()}`);
};

// Cron is evaluated in UTC (docs.netlify.com/build/functions/scheduled-functions, 2026-09).
export const config: Config = {
  schedule: "*/5 * * * *",
};
