/**
 * Feature flags.
 *
 * A missing key means on. Adding a flag must never turn off something that is
 * already shipped, and an admin turning one off has to be the only way a
 * feature disappears.
 */
export const FEATURE_FLAGS = ["google_places", "funeral_planner", "voice_input"] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export type FlagMap = Partial<Record<FeatureFlag, boolean>>;

export function isEnabled(flags: FlagMap | undefined, flag: FeatureFlag): boolean {
  return flags?.[flag] !== false;
}
