-- Scenario analysis on a decision that has already been made.
--
-- The board answers "which option, and why" at one moment. The question people
-- actually come back with is "what if the interest rate goes up", "what if I
-- lose the second income" - and the board cannot answer that, because it has
-- no memory of the assumptions it rests on.
--
-- Scenarios live on the decision itself rather than in their own table: they
-- are only ever read with it, never queried across decisions, and keeping them
-- together means a decision carries its own history of second thoughts.

ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS scenarios jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.decisions.scenarios IS
  'What-if runs against this board, newest last: [{question, result, at}].';
