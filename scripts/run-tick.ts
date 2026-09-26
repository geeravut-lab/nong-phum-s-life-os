// Runs one tick of the scheduled job against the database in .env.local.
//
//   npx tsx scripts/run-tick.ts            # now
//   npx tsx scripts/run-tick.ts 2026-09-14T03:00:00Z   # pretend it is this minute
//
// This is how the tick is exercised outside Netlify: Netlify Dev does not run
// schedules and `netlify functions:invoke` needs an interactive login. It hits
// whatever SUPABASE_URL points at, so on this project that is production —
// only ever run it with data you created to be deleted.
import { readFileSync } from "node:fs";

// .env.local on this machine has a UTF-8 BOM; strip it or the first key is lost.
for (const line of readFileSync(".env.local", "utf8")
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
}

const { runTick } = await import("../src/lib/cron.server");
const now = process.argv[2] ? new Date(process.argv[2]) : new Date();
const result = await runTick(now);
console.log(JSON.stringify(result, null, 2));
