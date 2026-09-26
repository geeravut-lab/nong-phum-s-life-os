import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isEnabled, type FeatureFlag, type FlagMap } from "@/lib/flags";

/**
 * The platform's feature flags, read once and cached.
 *
 * platform_settings is readable by any signed-in user (the pricing on the
 * support page comes from it), so this needs no server function. While the
 * query is in flight every flag reads as on, which is the safe direction: a
 * feature briefly appearing is better than the page flickering it away.
 */
export function useFeatureFlags() {
  const q = useQuery({
    queryKey: ["feature-flags"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("platform_settings")
        .select("feature_flags")
        .maybeSingle();
      return ((data?.feature_flags ?? {}) as FlagMap) ?? {};
    },
  });
  return {
    flags: q.data,
    enabled: (flag: FeatureFlag) => isEnabled(q.data, flag),
  };
}
