DROP POLICY IF EXISTS family_members_update_self ON public.family_members;

CREATE POLICY family_members_update_self ON public.family_members
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND member_role = (SELECT fm.member_role FROM public.family_members fm WHERE fm.id = family_members.id)
);

CREATE POLICY family_members_update_by_owner ON public.family_members
FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_members.family_id AND f.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_members.family_id AND f.owner_id = auth.uid()));