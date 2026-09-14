-- Phase 1.3 step 3.2: a rescheduled reminder is a new occurrence.
--
-- The tick claims an occurrence by setting reminders.notified_at. If the user
-- then moves due_at (or notify_at), the claim would still be there and the
-- moved occurrence would never be notified — not a duplicate, a silent miss.
--
-- Why a trigger and not the update path: there is no single update path.
-- RLS lets the browser write reminders directly (tasks.tsx does), the chat
-- action applier writes them, document intake writes them, and step 4 will
-- add LINE-side writers. A trigger is the one place every writer passes
-- through, and it makes the rule true for a row edited in the SQL editor too.
--
-- The engine's own advance (rollover in the tick, "done" in the UI) also
-- changes due_at and resets these columns explicitly; the trigger reaching the
-- same result is by design. A claim (UPDATE notified_at only) does not touch
-- due_at/notify_at, so it does not fire the reset.
--
-- Additive: one function, one trigger; DROP TRIGGER / DROP FUNCTION undoes it.
CREATE OR REPLACE FUNCTION public.reminders_reset_claim_on_reschedule()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.notify_at IS DISTINCT FROM OLD.notify_at THEN
    NEW.notified_at := NULL;
    NEW.notify_attempts := 0;
    NEW.notify_error := NULL;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_reminders_reset_claim
  BEFORE UPDATE OF due_at, notify_at ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.reminders_reset_claim_on_reschedule();
