import type { Config } from "@netlify/functions";
import { runTick } from "../../src/lib/cron.server";

// The app's only scheduled job. Deploys alongside the SSR handler that
// @netlify/vite-plugin-tanstack-start emits into .netlify/v1/functions/
// (proven 2026-09-14: both appear in the deploy, the schedule is registered,
// the log line shows up). Everything it does lives in src/lib/cron.server.ts
// so it can be exercised from a script; this file is only the entry point.
export default async () => {
  const result = await runTick();
  if (result.skipped) {
    console.info(`[tick] skipped: ${result.reason}`);
    return;
  }
  const level = result.error ? "error" : "info";
  console[level](`[tick] ${result.tick} ${JSON.stringify(result.summary)}${result.error ? ` error=${result.error}` : ""}`);
};

// Cron is evaluated in UTC (docs.netlify.com/build/functions/scheduled-functions, 2026-09).
export const config: Config = {
  schedule: "*/5 * * * *",
};
