-- "แชร์ให้ผู้ใช้อื่นใกล้เคียงเห็นได้" never did anything.
--
-- local_places.is_public was added, the merchant form wrote it, and then
-- nothing read it: the read policy was `is_active OR owner_user_id = auth.uid()`
-- and the page's own query carried a comment claiming it filtered on is_public
-- while having no such filter. So a merchant who unticked the box stayed
-- visible to every signed-in user - the opposite of what the box says.
--
-- A place that is not shared must also take its events and promotions with it.
-- Leaving those visible would announce the shop by another route, which is the
-- same disclosure with extra steps.
--
-- The owner and admins keep seeing everything, otherwise unticking the box
-- would hide the shop from the person who owns it.

DROP POLICY IF EXISTS local_places_read ON public.local_places;
CREATE POLICY local_places_read ON public.local_places
  FOR SELECT TO authenticated
  USING (
    (is_active AND is_public)
    OR owner_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS local_events_read ON public.local_events;
CREATE POLICY local_events_read ON public.local_events
  FOR SELECT TO authenticated
  USING (
    (
      is_active
      -- An event with no place of its own (a street market, a temple fair) is
      -- not anybody's shop, so it has nothing to be hidden with.
      AND (
        place_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.local_places p
          WHERE p.id = local_events.place_id AND p.is_public AND p.is_active
        )
      )
    )
    OR owner_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS local_deals_read ON public.local_deals;
CREATE POLICY local_deals_read ON public.local_deals
  FOR SELECT TO authenticated
  USING (
    (
      is_active
      AND EXISTS (
        SELECT 1 FROM public.local_places p
        WHERE p.id = local_deals.place_id AND p.is_public AND p.is_active
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.local_places p
      WHERE p.id = local_deals.place_id AND p.owner_user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );
