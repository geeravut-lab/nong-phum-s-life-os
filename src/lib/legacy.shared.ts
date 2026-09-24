export const ASSET_KINDS = [
  "bank",
  "investment",
  "stock",
  "fund",
  "insurance",
  "sso",
  "coop",
  "property",
  "vehicle",
  "business",
  "gold",
  "valuables",
  "digital",
  "debt",
  "loan_guarantee",
  "credit_card",
  "receivable",
  "benefit",
  "other",
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

export const WISH_SECTIONS = [
  "final_wishes",
  "funeral_pref",
  "life_story",
  "legacy_message",
  "will_ref",
  "vault_note",
] as const;

export type WishSection = (typeof WISH_SECTIONS)[number];
