import type { Dict } from "./i18n.dict";
import { parseNoticeBody } from "./notice-detail";

/**
 * Turning a stored notification into a sentence the reader understands.
 *
 * The row carries the kind, the values, and the Thai text that was written when
 * it happened. A kind with a template is rendered from the dictionary, so an
 * English reader gets English; anything else falls back to the stored text,
 * which is what every row written before templates existed has.
 */
export type NotificationRow = {
  kind: string;
  title: string;
  body: string;
  params?: Record<string, unknown> | null;
};

/**
 * Rows a database trigger wrote, which are copies of one somebody else sent.
 *
 * Until 20260928120000 an AFTER INSERT trigger on job_messages and job_offers
 * wrote its own notification, and so did notifyJobChat / notifyJobOffer - so a
 * single chat message showed up twice on this page, once with the job, the
 * sender and the time, and once as a bare line. The trigger is gone, but the
 * copies it already wrote are still in the table, and the trigger is the only
 * thing that ever pointed a notification at job_messages or job_offers (the
 * server functions point at the job), so they are recognisable and hidden.
 */
export const LEGACY_TRIGGER_REFS = ["job_messages", "job_offers"] as const;

/** The same rule as a PostgREST filter, so the copies never fill the page. */
export const NOT_LEGACY_TRIGGER_ROW = `ref_table.is.null,ref_table.not.in.(${LEGACY_TRIGGER_REFS.join(",")})`;

type Template = (t: Dict, p: Record<string, unknown>) => { title: string; body: string };

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown) => (v == null ? "" : String(v));

const TEMPLATES: Record<string, Template> = {
  job_offer: (t, p) => ({ title: t.notifJobOffer, body: str(p["jobTitle"]) }),
  job_accepted: (t, p) => ({ title: t.notifJobAccepted, body: str(p["jobTitle"]) }),
  job_message: (t, p) => ({ title: t.notifJobMessage, body: str(p["jobTitle"]) }),
  billing_result: (t) => ({ title: t.notifBillingResult, body: t.notifBillingResultBody }),
  funeral_selected: (t, p) => ({
    title: t.notifFuneralSelected,
    body: `${str(p["packageName"])} · ฿${num(p["total"]).toLocaleString()}`,
  }),
  funeral_review: (t, p) => ({
    title:
      str(p["decision"]) === "confirmed"
        ? t.notifFuneralConfirmed
        : str(p["decision"]) === "declined"
          ? t.notifFuneralDeclined
          : t.notifFuneralReviewing,
    body: str(p["note"]),
  }),
  funeral_evidence: (t, p) => ({ title: t.notifFuneralEvidence, body: str(p["title"]) }),
  funeral_installment: (t, p) => ({
    title: t.notifFuneralInstallment,
    body: `${t.fnInstallmentSeq} ${num(p["seq"])}`,
  }),
  funeral_fulfilment: (t, p) => ({
    title: t.notifFuneralFulfilment,
    body: str(p["mode"]) === "platform" ? t.fnPlatformRun : t.fnSelfRun,
  }),
};

/**
 * The "label: value" lines of a stored body, without its summary line.
 *
 * A template renders the summary in the reader's language but knows nothing
 * about the details, which were written into the body when the thing happened.
 * Keeping them means the app says as much as the LINE card does - the reader
 * should not have to check their phone to find out who assigned the task.
 */
function detailLines(body: string): string {
  return parseNoticeBody(body)
    .filter((p) => p.label)
    .map((p) => `${p.label}: ${p.value}`)
    .join("\n");
}

export function renderNotification(row: NotificationRow, t: Dict): { title: string; body: string } {
  const tpl = TEMPLATES[row.kind];
  const params = (row.params ?? {}) as Record<string, unknown>;
  // A template with no values behind it would render an empty sentence, which
  // is worse than the Thai text that was actually written at the time.
  const usable = tpl && (Object.keys(params).length > 0 || row.kind === "billing_result");
  if (!usable) return { title: row.title, body: row.body };

  const rendered = tpl(t, params);
  const details = detailLines(row.body);
  return details
    ? { ...rendered, body: [rendered.body, details].filter(Boolean).join("\n") }
    : rendered;
}
