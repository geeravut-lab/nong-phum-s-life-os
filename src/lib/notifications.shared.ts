import type { Dict } from "./i18n.dict";

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

export function renderNotification(row: NotificationRow, t: Dict): { title: string; body: string } {
  const tpl = TEMPLATES[row.kind];
  const params = (row.params ?? {}) as Record<string, unknown>;
  // A template with no values behind it would render an empty sentence, which
  // is worse than the Thai text that was actually written at the time.
  if (tpl && Object.keys(params).length > 0) return tpl(t, params);
  if (tpl && row.kind === "billing_result") return tpl(t, params);
  return { title: row.title, body: row.body };
}
