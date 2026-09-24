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

const KIND_KEYS: Record<AssetKind, string> = {
  bank: "legacyKind_bank",
  investment: "legacyKind_investment",
  stock: "legacyKind_stock",
  fund: "legacyKind_fund",
  insurance: "legacyKind_insurance",
  sso: "legacyKind_sso",
  coop: "legacyKind_coop",
  property: "legacyKind_property",
  vehicle: "legacyKind_vehicle",
  business: "legacyKind_business",
  gold: "legacyKind_gold",
  valuables: "legacyKind_valuables",
  digital: "legacyKind_digital",
  debt: "legacyKind_debt",
  loan_guarantee: "legacyKind_loan_guarantee",
  credit_card: "legacyKind_credit_card",
  receivable: "legacyKind_receivable",
  benefit: "legacyKind_benefit",
  other: "legacyKind_other",
};

const SEC_KEYS: Record<WishSection, string> = {
  final_wishes: "legacySec_final_wishes",
  funeral_pref: "legacySec_funeral_pref",
  life_story: "legacySec_life_story",
  legacy_message: "legacySec_legacy_message",
  will_ref: "legacySec_will_ref",
  vault_note: "legacySec_vault_note",
};

/** Resolve label from i18n dict object (t). */
export function labelAssetKind(t: Record<string, unknown>, kind: string): string {
  const key = KIND_KEYS[kind as AssetKind];
  const v = key ? t[key] : undefined;
  return typeof v === "string" ? v : kind;
}

export function labelWishSection(t: Record<string, unknown>, section: string): string {
  const key = SEC_KEYS[section as WishSection];
  const v = key ? t[key] : undefined;
  return typeof v === "string" ? v : section;
}
