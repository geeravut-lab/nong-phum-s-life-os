import type { Dict } from "./i18n.dict";

/**
 * Server errors the user is meant to read.
 *
 * A server function has no idea which language the person in front of the
 * browser reads - the dictionary lives on the client - so it throws a code and
 * the client looks the sentence up. Anything else (a Postgres message, a
 * network failure) still shows as-is, because inventing a friendly sentence for
 * an unknown failure hides what actually happened.
 */
export const APP_ERROR_CODES = [
  "agenda_locked",
  "agenda_share_first",
  "agenda_assignee_not_in_family",
  "agenda_past_event",
  "agenda_task_time_locked",
  "billing_no_promptpay",
  "billing_already_rejected",
  "promote_needs_premium",
  "quota_payg_required",
  "quota_exhausted",
  "quota_fair_use",
  "google_key_missing",
  "webhook_bad_url",
  "webhook_limit",
  "feature_off",
  "ai_suspended",
  "trial_already_used",
  "trip_plan_limit",
  "reminder_not_found",
  "reminder_forbidden",
  "document_duplicate",
  "funeral_in_review",
  "funeral_committed",
  "funeral_no_plan",
  "funeral_schedule_locked",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

const PREFIX = "app:";

/** Throw one of these from a server function instead of a Thai sentence. */
export function appError(code: AppErrorCode): Error {
  return new Error(PREFIX + code);
}

export function appErrorCode(e: unknown): AppErrorCode | null {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  // A server function's error arrives with the message the server threw, but
  // frameworks are free to wrap it, so look for the marker anywhere in it.
  const at = msg.indexOf(PREFIX);
  if (at === -1) return null;
  const rest = msg.slice(at + PREFIX.length).match(/^[a-z_]+/)?.[0];
  return (APP_ERROR_CODES as readonly string[]).includes(rest ?? "")
    ? (rest as AppErrorCode)
    : null;
}

type ErrKey = `err_${AppErrorCode}`;
// Compile-time guarantee that every code has a sentence in both languages: the
// Dict type is derived from the Thai object, so a missing key fails the build.
type _EveryCodeIsTranslated = ErrKey extends keyof Dict ? true : never;
const _check: _EveryCodeIsTranslated = true;
void _check;

/** What to put in a toast. */
export function errorText(e: unknown, t: Dict): string {
  const code = appErrorCode(e);
  if (code) return t[`err_${code}` as ErrKey] as string;
  if (e instanceof Error && e.message) return e.message;
  // Some server functions return a message rather than throwing, and that
  // message can carry a code too.
  if (typeof e === "string" && e.trim()) return e;
  return t.error;
}
