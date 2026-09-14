// How long things are kept before the scheduled tick removes them. Shared by
// the tick (server) and the UI (the Docs page tells the user when a failed
// document will go), so the number the user reads is the number that applies.
// No imports: this file is part of the client bundle.

/** documents.status = 'failed': kept so the user can retry after a bad day at the AI provider. */
export const FAILED_DOC_RETENTION_DAYS = 30;

/** documents.status = 'pending' older than this is a tab closed mid-upload; nothing can resume it. */
export const PENDING_DOC_RETENTION_HOURS = 1;

/** ai_events: fallbacks and errors, only useful while someone might still look. */
export const AI_EVENT_RETENTION_DAYS = 30;

/** notification_log: must cover at least two LINE billing months so the quota count never runs short. */
export const NOTIFICATION_LOG_RETENTION_DAYS = 90;

/** cron_ticks: the tick's own run log. */
export const CRON_TICK_RETENTION_DAYS = 30;

/**
 * Whole days until a failed document is removed, never below 0. Counted from
 * the row's updated_at: a retry rewrites it, so retrying restarts the clock.
 */
export function daysUntilFailedDocRemoved(updatedAt: string, now: Date = new Date()): number {
  const deadline = new Date(updatedAt).getTime() + FAILED_DOC_RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((deadline - now.getTime()) / 86_400_000));
}
