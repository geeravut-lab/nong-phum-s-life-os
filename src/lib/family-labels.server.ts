import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * A usable name for everyone in a family.
 *
 * Three places to look, because a member row may carry a nickname, a profile
 * may carry a name, and an account that has never set either still has an
 * email. Falling all the way through to eight characters of a uuid is not a
 * name, but it is at least stable and tells two people apart.
 *
 * Exported because the chat router needs the same names: "มอบหมายให้ต้น" can
 * only resolve to a person if the model was shown that a person is called ต้น.
 */
export async function resolveMemberLabels(
  familyId: string,
): Promise<Array<{ memberId: string; userId: string; role: string; label: string }>> {
  const { data: members, error } = await supabaseAdmin
    .from("family_members")
    .select("id, user_id, member_role, display_name")
    .eq("family_id", familyId);
  if (error) throw new Error(error.message);

  const labels: Array<{ memberId: string; userId: string; role: string; label: string }> = [];
  for (const m of members ?? []) {
    let label = (m.display_name as string | null)?.trim() || "";
    if (!label) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", m.user_id)
        .maybeSingle();
      label = (prof?.display_name as string | null)?.trim() || "";
    }
    if (!label) {
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.user_id as string);
        label =
          (u.user?.user_metadata as Record<string, string> | undefined)?.["full_name"] ||
          (u.user?.user_metadata as Record<string, string> | undefined)?.["name"] ||
          u.user?.email?.split("@")[0] ||
          "";
      } catch {
        /* ignore */
      }
    }
    if (!label) label = (m.user_id as string).slice(0, 8);
    labels.push({
      memberId: m.id as string,
      userId: m.user_id as string,
      role: (m.member_role as string) || "member",
      label,
    });
  }
  return labels;
}
