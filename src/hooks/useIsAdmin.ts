import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";

/** UI-only admin flag. Server functions still enforce requireAdmin / RLS. */
export function useIsAdmin() {
  const { user } = useAuthUser();
  return useQuery({
    queryKey: ["is-admin", user?.id ?? "anon"],
    enabled: !!user?.id,
    staleTime: 30_000,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: user!.id,
        _role: "admin",
      });
      if (error) return false;
      return data === true;
    },
  });
}
