-- One notification per job event, not two.
--
-- 20260924190000 gave job_messages and job_offers AFTER INSERT triggers that
-- wrote an app_notifications row themselves. Since then the browser also calls
-- notifyJobChat / notifyJobOffer, which write a *detailed* row (who wrote, on
-- which job, when; the quote's price and ETA) and - the part the trigger never
-- did - queue the same text for LINE and for webhooks.
--
-- So every chat message and every new quote produced two cards on the
-- notifications page: the detailed one and a bare one-line copy. The server
-- functions are the ones that carry the detail, so the triggers go.
--
-- The copies already written are left in place; the inbox hides them, see
-- LEGACY_TRIGGER_REFS in src/routes/_authenticated/inbox.tsx.

DROP TRIGGER IF EXISTS trg_job_message_notify ON public.job_messages;
DROP TRIGGER IF EXISTS trg_job_offer_notify ON public.job_offers;
DROP FUNCTION IF EXISTS public.trg_job_message_notify();
DROP FUNCTION IF EXISTS public.trg_job_offer_notify();
