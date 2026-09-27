import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appError } from "@/lib/errors";
import { isEnabled, type FeatureFlag, type FlagMap } from "@/lib/flags";

/**
 * The authoritative side of a feature switch.
 *
 * Hiding a button is not turning a feature off: the server function behind it
 * is still callable by anyone who knows it exists, and in the case of Google
 * Places that means the bill keeps running. So every flag is checked here, on
 * the server, and the UI check is only there to stop the user meeting an error
 * for a feature they were never offered.
 *
 * Cached for a minute per instance: this is read in front of AI calls, and an
 * admin flipping a switch can wait a minute for it to take hold everywhere.
 */
const TTL_MS = 60_000;
let cache: { flags: FlagMap; at: number } | undefined;

export async function loadFlags(): Promise<FlagMap> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.flags;
  try {
    const { data } = await supabaseAdmin
      .from("platform_settings")
      .select("feature_flags")
      .maybeSingle();
    cache = { flags: ((data?.feature_flags ?? {}) as FlagMap) ?? {}, at: now };
  } catch (err) {
    // A settings read that fails must not take a working feature down with it:
    // keep whatever we had, and treat everything as on if we never had any.
    console.warn("[flags] could not read:", err instanceof Error ? err.message : err);
    cache = { flags: cache?.flags ?? {}, at: now };
  }
  return cache.flags;
}

export async function featureEnabled(flag: FeatureFlag): Promise<boolean> {
  return isEnabled(await loadFlags(), flag);
}

/** Refuse the call when an admin has switched the feature off. */
export async function assertFeature(flag: FeatureFlag): Promise<void> {
  if (!(await featureEnabled(flag))) throw appError("feature_off");
}
