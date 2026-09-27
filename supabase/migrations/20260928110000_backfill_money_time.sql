-- Cards for older money rows showed a day and no time.
--
-- The rule everywhere in the app is that a time nobody stated is the time of
-- saving. Rows written before the spent_at / received_at columns existed, and
-- rows filed from an uploaded document, never got one - so a list mixed cards
-- that carried a clock with cards that did not, for no reason a reader could
-- see.
--
-- created_at is when the row was saved, which is exactly the fallback the rule
-- names. The DAY still comes from spent_on: a September expense entered in
-- December must not become a December timestamp. So the wall-clock time of
-- created_at, read in Bangkok, is attached to the day the row already claims.
--
-- 20260927250000 deliberately left these null, on the grounds that filling
-- 00:00 would claim a time that never happened. That still holds - this does
-- not fill 00:00. It fills the time the row was actually written, which is a
-- fact the table already had and was not using.
--
-- Only rows where the column is null. Nothing anyone stated is overwritten.

UPDATE public.expenses
SET spent_at = (spent_on::timestamp + (created_at AT TIME ZONE 'Asia/Bangkok')::time)
               AT TIME ZONE 'Asia/Bangkok'
WHERE spent_at IS NULL
  AND spent_on IS NOT NULL;

UPDATE public.incomes
SET received_at = (received_on::timestamp + (created_at AT TIME ZONE 'Asia/Bangkok')::time)
                  AT TIME ZONE 'Asia/Bangkok'
WHERE received_at IS NULL
  AND received_on IS NOT NULL;
