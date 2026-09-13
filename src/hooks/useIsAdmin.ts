import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Whether the signed-in user holds the admin role, asked of the database.
 *
 * This only decides what the UI shows (the Admin menu entry, the /admin
 * route's redirect). It is not a permission check: every admin server
 * function runs requireAdmin, and ai_settings/ai_events enforce has_role in
 * their RLS, so a forged `true` here gets someone an empty page, not access.
 */
export function useIsAdmin() {
  return useQuery({
    queryKey: ["is-admin"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
      if (error) return false;
      return data === true;
    },
  });
}
