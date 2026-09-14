// LINE delivery for the scheduled tick (phase 1.3 step 4b). cron.server.ts
// creates notification_log rows; this module decides whether a user can be
// reached, sends what is queued, retries, and keeps the monthly quota from
// running dry unnoticed. Relative imports only (bundled into the tick).
//
// Quota guard, the part that keeps the whole system from going quiet:
//   used   = max(rows sent this month in notification_log, LINE's totalUsage)
//   digest stops at  cap - reserve      immediate stops at  cap
// cap/reserve live in notification_settings so an admin can move them
// without a deploy. LINE's own number can lag (docs), the log cannot; taking
// the larger of the two errs on the side of not sending.
//
// Error handling per push (docs, Messaging API reference):
//   401/403 auth     → the channel token is wrong: HALT everything for 6 h,
//                      write an ai_events row so the admin console shows it
//   400 target       → user id not valid for this channel: mark the link
//                      blocked, never retry
//   429 "monthly"    → quota gone: mark skipped, ai_events row, stop this tick
//   5xx / network /  → retryable: attempts+1, next tick tries again, failed
//   timeout / 429      after MAX_ATTEMPTS
//   409              → LINE already accepted this X-Line-Retry-Key: counts as sent
import { supabaseAdmin } from "../integrations/supabase/client.server";
import { digestCard, immediateCard, type FlexReminder } from "./line-flex";
import { appOpenUrl, checkFriend, getQuota, lineChannelToken, pushFlex, type LineQuota } from "./line-push.server";
import { bangkokDateAtHour, monthStartInBangkok, todayInBangkok } from "./time";

export const MAX_ATTEMPTS = 3;
const HALT_HOURS = 6;
// A friend check older than this is redone before a push; a user who added
// the OA after being marked "not a friend" is picked up within the hour.
const FRIEND_CHECK_TTL_MS = 60 * 60_000;
const DELIVER_BATCH = 20;

export type NotificationSettings = {
  line_monthly_cap: number;
  line_digest_reserve: number;
  line_digest_hour: number;
  line_halted_until: string | null;
  line_halt_reason: string | null;
};

const DEFAULT_SETTINGS: NotificationSettings = {
  line_monthly_cap: 300,
  line_digest_reserve: 50,
  line_digest_hour: 8,
  line_halted_until: null,
  line_halt_reason: null,
};

export type LineLinkRow = {
  user_id: string;
  line_user_id: string;
  is_friend: boolean;
  friend_checked_at: string | null;
  blocked_at: string | null;
};

export type LineContext = {
  now: Date;
  token: string | null;
  settings: NotificationSettings;
  /** Rows sent this month per our own log (authoritative floor). */
  sentThisMonth: number;
  /** LINE's number, fetched once per tick on first use. */
  lineUsage: LineQuota | null;
  links: Map<string, LineLinkRow | null>;
  /** Set when an auth error or quota exhaustion stops sending for this tick. */
  stopped: string | null;
  summary: Record<string, number | string>;
};

/**
 * First instant of the current Bangkok month. Bangkok, not UTC: otherwise on
 * the 1st between 00:00 and 07:00 local time the count would still include
 * the previous month (the same off-by-a-zone bug fixed in 1.8).
 */
export function monthStartIso(now: Date): string {
  return bangkokDateAtHour(monthStartInBangkok(now), 0);
}

export async function loadSettings(): Promise<NotificationSettings> {
  const { data, error } = await supabaseAdmin.from("notification_settings").select("*").eq("id", true).maybeSingle();
  if (error || !data) {
    if (error) console.error(`[line] notification_settings read: ${error.message}`);
    return DEFAULT_SETTINGS;
  }
  return data;
}

export async function sentThisMonth(now: Date): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("notification_log")
    .select("id", { count: "exact", head: true })
    .eq("channel", "line")
    .eq("status", "sent")
    .gte("created_at", monthStartIso(now));
  if (error) throw new Error(`notification_log count: ${error.message}`);
  return count ?? 0;
}

export async function loadLineContext(now: Date, summary: Record<string, number | string>): Promise<LineContext> {
  return {
    now,
    token: lineChannelToken(),
    settings: await loadSettings(),
    sentThisMonth: await sentThisMonth(now),
    lineUsage: null,
    links: new Map(),
    stopped: null,
    summary,
  };
}

export function isHalted(ctx: LineContext): boolean {
  const until = ctx.settings.line_halted_until;
  return !!until && new Date(until).getTime() > ctx.now.getTime();
}

/** The user's LINE link, read once per tick. */
export async function linkFor(ctx: LineContext, userId: string): Promise<LineLinkRow | null> {
  if (ctx.links.has(userId)) return ctx.links.get(userId)!;
  const { data, error } = await supabaseAdmin
    .from("line_links")
    .select("user_id, line_user_id, is_friend, friend_checked_at, blocked_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`line_links read: ${error.message}`);
  ctx.links.set(userId, data ?? null);
  return data ?? null;
}

/**
 * Can this user be reached right now? Uses the stored answer while it is
 * fresh; otherwise asks the profile endpoint and stores the result. Returns
 * false (never throws) when the check itself fails, so a LINE hiccup delays
 * a push rather than crashing the tick.
 */
export async function ensureFriend(ctx: LineContext, link: LineLinkRow): Promise<boolean> {
  const age = link.friend_checked_at ? ctx.now.getTime() - new Date(link.friend_checked_at).getTime() : Infinity;
  if (age < FRIEND_CHECK_TTL_MS) return link.is_friend && !link.blocked_at;
  if (!ctx.token) return link.is_friend && !link.blocked_at;

  const res = await checkFriend(ctx.token, link.line_user_id);
  if (!res.ok) {
    if (res.kind === "auth") await haltLine(ctx, `profile ${res.status}: ${res.message}`);
    return false;
  }
  const patch = {
    is_friend: res.friend,
    friend_checked_at: ctx.now.toISOString(),
    blocked_at: res.friend ? null : (link.blocked_at ?? ctx.now.toISOString()),
    ...(res.displayName ? { display_name: res.displayName } : {}),
    ...(res.pictureUrl ? { picture_url: res.pictureUrl } : {}),
  };
  const { error } = await supabaseAdmin.from("line_links").update(patch).eq("user_id", link.user_id);
  if (error) console.error(`[line] line_links update: ${error.message}`);
  Object.assign(link, patch);
  return res.friend;
}

/** Stops all sending for HALT_HOURS and leaves a visible trace. */
export async function haltLine(ctx: LineContext, reason: string): Promise<void> {
  const until = new Date(ctx.now.getTime() + HALT_HOURS * 3_600_000).toISOString();
  ctx.settings.line_halted_until = until;
  ctx.settings.line_halt_reason = reason;
  ctx.stopped = "auth";
  const { error } = await supabaseAdmin
    .from("notification_settings")
    .update({ line_halted_until: until, line_halt_reason: reason.slice(0, 500) })
    .eq("id", true);
  if (error) console.error(`[line] could not write halt: ${error.message}`);
  await lineEvent("error", "auth_failed", `LINE halted until ${until}: ${reason}`);
  console.error(`[line] HALTED until ${until}: ${reason}`);
}

async function lineEvent(status: "error" | "fallback", code: string, message: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("ai_events")
    .insert({ provider: "line", task: "push", status, error_code: code, message: message.slice(0, 1000) });
  if (error) console.error(`[line] could not write ai_events: ${error.message}`);
}

/** Bangkok hour of `now`, 0–23. */
export function bangkokHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Today's digest if it has not gone out yet, otherwise tomorrow's. */
export async function targetDigestDate(userId: string, now: Date): Promise<string> {
  const today = todayInBangkok(now);
  const { data } = await supabaseAdmin
    .from("notification_log")
    .select("status")
    .eq("kind", "digest")
    .eq("user_id", userId)
    .eq("digest_date", today)
    .maybeSingle();
  if (data && data.status !== "queued") {
    const t = new Date(bangkokDateAtHour(today, 12));
    t.setUTCDate(t.getUTCDate() + 1);
    return todayInBangkok(t);
  }
  return today;
}

/** Larger of our own count and LINE's, fetching LINE's once per tick. */
async function usedThisMonth(ctx: LineContext): Promise<number> {
  if (ctx.token && ctx.lineUsage === null) {
    ctx.lineUsage = await getQuota(ctx.token);
    ctx.summary["line_quota"] = JSON.stringify({ own: ctx.sentThisMonth, line: ctx.lineUsage.totalUsage, limit: ctx.lineUsage.limit });
  }
  return Math.max(ctx.sentThisMonth, ctx.lineUsage?.totalUsage ?? 0);
}

type LogRow = {
  id: string;
  user_id: string;
  kind: "immediate" | "digest";
  reminder_id: string | null;
  due_at: string | null;
  digest_date: string | null;
  reminder_ids: string[];
  attempts: number;
};

async function mark(row: LogRow, patch: { status: string; error?: string | null; bump?: boolean }): Promise<void> {
  const { error } = await supabaseAdmin
    .from("notification_log")
    .update({ status: patch.status, error: patch.error ?? null, ...(patch.bump ? { attempts: row.attempts + 1 } : {}) })
    .eq("id", row.id);
  if (error) console.error(`[line] notification_log update ${row.id}: ${error.message}`);
  if (patch.bump) row.attempts += 1;
}

/**
 * Sends every queued LINE row that is due to go: immediates at once, digests
 * from the configured hour on their day. Returns how many were sent.
 */
export async function deliverQueued(ctx: LineContext, overBudget: () => boolean): Promise<number> {
  if (!ctx.token) return 0;
  if (isHalted(ctx)) {
    ctx.summary["line_halted"] = ctx.settings.line_halt_reason ?? "halted";
    return 0;
  }
  const today = todayInBangkok(ctx.now);
  const digestOpen = bangkokHour(ctx.now) >= ctx.settings.line_digest_hour;

  const { data: rows, error } = await supabaseAdmin
    .from("notification_log")
    .select("id, user_id, kind, reminder_id, due_at, digest_date, reminder_ids, attempts")
    .eq("channel", "line")
    .eq("status", "queued")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(DELIVER_BATCH);
  if (error) throw new Error(`notification_log queued select: ${error.message}`);

  let sent = 0;
  for (const row of (rows ?? []) as LogRow[]) {
    if (overBudget() || ctx.stopped) break;
    if (row.kind === "digest") {
      if (!row.digest_date || row.digest_date > today) continue;
      if (row.digest_date === today && !digestOpen) continue;
    }

    // Quota. Digests are the first thing to give up.
    const used = await usedThisMonth(ctx);
    const { line_monthly_cap: cap, line_digest_reserve: reserve } = ctx.settings;
    if (used >= cap) {
      await mark(row, { status: "skipped", error: `quota_cap: ${used}/${cap}` });
      if (!ctx.summary["line_quota_cap_hit"]) {
        await lineEvent("error", "quota_cap", `LINE monthly cap reached: ${used}/${cap}`);
        ctx.summary["line_quota_cap_hit"] = used;
      }
      continue;
    }
    if (row.kind === "digest" && used >= cap - reserve) {
      await mark(row, { status: "skipped", error: `quota_reserve: ${used}/${cap - reserve}` });
      ctx.summary["line_digest_reserved"] = Number(ctx.summary["line_digest_reserved"] ?? 0) + 1;
      continue;
    }

    // Recipient.
    const link = await linkFor(ctx, row.user_id);
    if (!link) {
      await mark(row, { status: "skipped", error: "no_link" });
      continue;
    }
    if (!(await ensureFriend(ctx, link))) {
      if (ctx.stopped) break;
      await mark(row, { status: "skipped", error: "not_friend" });
      continue;
    }

    // Content — read fresh so a reminder completed meanwhile is not announced.
    const ids = row.kind === "immediate" ? [row.reminder_id!] : row.reminder_ids;
    const { data: rems, error: remErr } = await supabaseAdmin
      .from("reminders")
      .select("id, title, due_at, priority, recurrence, notes, status")
      .in("id", ids)
      .eq("status", "open");
    if (remErr) throw new Error(`reminders read for push: ${remErr.message}`);
    const open = (rems ?? []) as (FlexReminder & { status: string })[];
    if (open.length === 0) {
      await mark(row, { status: "skipped", error: row.kind === "immediate" ? "reminder_gone" : "nothing_open" });
      continue;
    }
    const url = appOpenUrl("/today");
    const message =
      row.kind === "immediate"
        ? immediateCard(open[0]!, url)
        : digestCard(
            open.sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? "")),
            bangkokDateAtHour(row.digest_date!, 12),
            url,
          );

    const res = await pushFlex(ctx.token, link.line_user_id, message, row.id);
    if (res.ok) {
      await mark(row, { status: "sent", error: res.duplicate ? "accepted_earlier" : null, bump: true });
      ctx.sentThisMonth += 1;
      sent += 1;
      continue;
    }
    switch (res.kind) {
      case "auth":
        await haltLine(ctx, `push ${res.status}: ${res.message}`);
        break;
      case "quota":
        await mark(row, { status: "skipped", error: `line_429_monthly: ${res.message}` });
        await lineEvent("error", "quota_line", `LINE says monthly limit reached: ${res.message}`);
        ctx.stopped = "quota";
        break;
      case "target": {
        await mark(row, { status: "failed", error: `line_400: ${res.message}`, bump: true });
        const patch = { is_friend: false, blocked_at: ctx.now.toISOString(), friend_checked_at: ctx.now.toISOString() };
        await supabaseAdmin.from("line_links").update(patch).eq("user_id", link.user_id);
        Object.assign(link, patch);
        break;
      }
      case "retryable": {
        const final = row.attempts + 1 >= MAX_ATTEMPTS;
        await mark(row, { status: final ? "failed" : "queued", error: `line_${res.status}: ${res.message}`, bump: true });
        if (final && row.reminder_id) {
          await supabaseAdmin.from("reminders").update({ notify_error: `line_${res.status}`, notify_attempts: MAX_ATTEMPTS }).eq("id", row.reminder_id);
        }
        ctx.summary["line_retries"] = Number(ctx.summary["line_retries"] ?? 0) + 1;
        break;
      }
    }
  }
  return sent;
}
