import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isEnabled, type FeatureFlag, type FlagMap } from "@/lib/flags";

type PlatformSettings = { flags: FlagMap; manualUrl: string };

/**
 * The one row of platform-wide settings every page needs, read once.
 *
 * platform_settings is readable by any signed-in user (the pricing on the
 * support page comes from it), so this needs no server function. Flags and the
 * manual link share a query so the app makes one request, not two.
 *
 * It used to be cached for five minutes, which meant an admin turning a switch
 * off reached nobody until they reloaded the tab: moving between pages does
 * not refetch a query that React Query still considers fresh, and the switch
 * looked broken. Thirty seconds of staleness means a page change picks the new
 * value up almost at once, the poll catches a user who is sitting still, and
 * coming back to the tab re-reads it. A minute is also what the server-side
 * cache in flags.server.ts holds, so the button and the call behind it stop
 * working at roughly the same moment rather than one lingering after the
 * other.
 */
export function usePlatformSettings() {
  return useQuery<PlatformSettings>({
    queryKey: ["feature-flags"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await supabase
        .from("platform_settings")
        .select("feature_flags, manual_url")
        .maybeSingle();
      return {
        flags: ((data?.feature_flags ?? {}) as FlagMap) ?? {},
        manualUrl: ((data?.manual_url ?? "") as string).trim(),
      };
    },
  });
}

/**
 * While the query is in flight every flag reads as on, which is the safe
 * direction: a feature briefly appearing is better than the page flickering it
 * away.
 */
export function useFeatureFlags() {
  const q = usePlatformSettings();
  return {
    flags: q.data?.flags,
    enabled: (flag: FeatureFlag) => isEnabled(q.data?.flags, flag),
  };
}

/** The admin-set link to the user manual, or "" when none has been set. */
export function useManualUrl(): string {
  return usePlatformSettings().data?.manualUrl ?? "";
}
