-- A task you were given, that you cannot see.
--
-- Reading someone else's reminder required is_shared, so unsharing a task
-- silently took it away from the person it was assigned to - they keep the
-- notification saying it is theirs, and the task is nowhere on their page.
-- Assigning is already blocked on an unshared task; this is the other half,
-- for the task that was shared when it was assigned and unshared afterwards.
--
-- The assignee gets read access, not write: it is still the owner's task, they
-- are being asked to do it. Marking it done goes through the server function
-- that already checks who may.

DROP POLICY IF EXISTS reminders_assignee_read ON public.reminders;
CREATE POLICY reminders_assignee_read ON public.reminders
  FOR SELECT TO authenticated
  USING (assignee_user_id = auth.uid());
