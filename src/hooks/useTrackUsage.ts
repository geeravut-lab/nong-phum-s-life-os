import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { normalizeUsagePath } from "@/lib/usage";

/**
 * Count one view per navigation, for the admin usage dashboard.
 *
 * Deliberately fire-and-forget: analytics must never delay a page or surface an
 * error to the user, so a failure is logged to the console and dropped. The
 * counter itself lives in bump_usage (a security definer function), so the
 * client cannot write an arbitrary number, and only the path reaches the
 * server - no titles, no query strings, no ids.
 */
export function useTrackUsage(): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuthUser();

  useEffect(() => {
    if (!user?.id) return;
    const path = normalizeUsagePath(pathname);
    void supabase.rpc("bump_usage", { p_path: path }).then(({ error }) => {
      if (error) console.warn("[usage] bump failed:", error.message);
    });
  }, [pathname, user?.id]);
}
