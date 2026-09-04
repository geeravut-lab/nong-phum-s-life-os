import type { Lang } from "@/lib/i18n";

export type BenefitEligibility = {
  min_age?: number;
  max_age?: number;
  max_annual_income?: number;
  groups?: string[];
  requires_social_security?: boolean;
  requires_no_social_security?: boolean;
};

export type BenefitRow = {
  id: string;
  slug: string;
  title: string;
  title_en: string | null;
  provider: string;
  category: string;
  summary: string;
  how_to: string;
  link: string | null;
  est_value: number | null;
  eligibility: unknown;
};

export type BenefitProfile = {
  birth_year: number | null;
  monthly_income: number | null;
  occupation: string | null;
  province: string | null;
  household_size: number | null;
  groups: string[];
  has_social_security: boolean;
  has_welfare_card: boolean;
};

export type MatchLevel = "eligible" | "maybe" | "not";

export type BenefitMatch = {
  benefit: BenefitRow;
  level: MatchLevel;
  score: number;
  reasons: { th: string; en: string }[];
};

export const BENEFIT_GROUPS = [
  "elderly",
  "disabled",
  "student",
  "parent",
  "farmer",
  "freelance",
  "employee",
  "unemployed",
] as const;

export const groupLabels: Record<string, { th: string; en: string }> = {
  elderly: { th: "ผู้สูงอายุ", en: "Elderly" },
  disabled: { th: "ผู้พิการ", en: "Person with disability" },
  student: { th: "นักเรียน/นักศึกษา", en: "Student" },
  parent: { th: "มีบุตรอายุต่ำกว่า 6 ปี", en: "Parent of a child under 6" },
  farmer: { th: "เกษตรกร", en: "Farmer" },
  freelance: { th: "อาชีพอิสระ", en: "Freelancer" },
  employee: { th: "พนักงานประจำ", en: "Employee" },
  unemployed: { th: "กำลังว่างงาน", en: "Unemployed" },
};

export const benefitCategoryLabels: Record<string, { th: string; en: string }> = {
  elderly: { th: "ผู้สูงอายุ", en: "Elderly" },
  disability: { th: "ผู้พิการ", en: "Disability" },
  income: { th: "ผู้มีรายได้น้อย", en: "Low income" },
  family: { th: "ครอบครัว", en: "Family" },
  health: { th: "สุขภาพ", en: "Health" },
  tax: { th: "ภาษี", en: "Tax" },
  education: { th: "การศึกษา", en: "Education" },
  agriculture: { th: "เกษตร", en: "Agriculture" },
  work: { th: "การทำงาน", en: "Work" },
  housing: { th: "ที่อยู่อาศัย", en: "Housing" },
  other: { th: "อื่น ๆ", en: "Other" },
};

export function pickLabel(map: Record<string, { th: string; en: string }>, key: string, lang: Lang) {
  return map[key]?.[lang] ?? key;
}

export function parseEligibility(value: unknown): BenefitEligibility {
  return value && typeof value === "object" ? (value as BenefitEligibility) : {};
}

export function benefitTitle(b: BenefitRow, lang: Lang) {
  return lang === "en" && b.title_en ? b.title_en : b.title;
}

export function matchBenefit(benefit: BenefitRow, profile: BenefitProfile | null): BenefitMatch {
  const rules = parseEligibility(benefit.eligibility);
  const reasons: BenefitMatch["reasons"] = [];
  let score = 50;
  let level: MatchLevel = "maybe";
  let blocked = false;
  let matchedSomething = false;

  const age =
    profile?.birth_year && profile.birth_year > 1900
      ? new Date().getFullYear() - profile.birth_year
      : null;
  const annualIncome = profile?.monthly_income != null ? profile.monthly_income * 12 : null;

  if (rules.min_age != null) {
    if (age == null) {
      reasons.push({ th: `ต้องอายุ ${rules.min_age} ปีขึ้นไป (ยังไม่ทราบอายุ)`, en: `Requires age ${rules.min_age}+ (age unknown)` });
    } else if (age >= rules.min_age) {
      matchedSomething = true;
      score += 20;
      reasons.push({ th: `อายุ ${age} ปี ผ่านเกณฑ์ ${rules.min_age} ปีขึ้นไป`, en: `Age ${age} meets the ${rules.min_age}+ requirement` });
    } else {
      blocked = true;
      reasons.push({ th: `ต้องอายุ ${rules.min_age} ปีขึ้นไป`, en: `Requires age ${rules.min_age}+` });
    }
  }

  if (rules.max_age != null && age != null) {
    if (age <= rules.max_age) {
      score += 10;
    } else {
      blocked = true;
      reasons.push({ th: `เกินเกณฑ์อายุไม่เกิน ${rules.max_age} ปี`, en: `Above the max age of ${rules.max_age}` });
    }
  }

  if (rules.max_annual_income != null) {
    if (annualIncome == null) {
      reasons.push({
        th: `รายได้ต้องไม่เกิน ${rules.max_annual_income.toLocaleString()} บาท/ปี (ยังไม่ได้กรอกรายได้)`,
        en: `Income must be under ${rules.max_annual_income.toLocaleString()} THB/year (income not filled in)`,
      });
    } else if (annualIncome <= rules.max_annual_income) {
      matchedSomething = true;
      score += 20;
      reasons.push({
        th: `รายได้ประมาณ ${annualIncome.toLocaleString()} บาท/ปี อยู่ในเกณฑ์`,
        en: `Around ${annualIncome.toLocaleString()} THB/year fits the limit`,
      });
    } else {
      blocked = true;
      reasons.push({
        th: `รายได้เกินเกณฑ์ ${rules.max_annual_income.toLocaleString()} บาท/ปี`,
        en: `Income above the ${rules.max_annual_income.toLocaleString()} THB/year limit`,
      });
    }
  }

  if (rules.groups?.length) {
    const mine = profile?.groups ?? [];
    const hit = rules.groups.filter((g) => mine.includes(g));
    if (hit.length) {
      matchedSomething = true;
      score += 25;
      reasons.push({
        th: `ตรงกับกลุ่ม: ${hit.map((g) => pickLabel(groupLabels, g, "th")).join(", ")}`,
        en: `Matches group: ${hit.map((g) => pickLabel(groupLabels, g, "en")).join(", ")}`,
      });
    } else {
      blocked = true;
      reasons.push({
        th: `สำหรับกลุ่ม: ${rules.groups.map((g) => pickLabel(groupLabels, g, "th")).join(", ")}`,
        en: `For: ${rules.groups.map((g) => pickLabel(groupLabels, g, "en")).join(", ")}`,
      });
    }
  }

  if (rules.requires_social_security) {
    if (profile?.has_social_security) {
      matchedSomething = true;
      score += 15;
    } else {
      blocked = true;
      reasons.push({ th: "ต้องเป็นผู้ประกันตนในระบบประกันสังคม", en: "Requires an active social security registration" });
    }
  }

  if (rules.requires_no_social_security && profile?.has_social_security) {
    blocked = true;
    reasons.push({ th: "สำหรับผู้ที่ไม่ได้อยู่ในระบบประกันสังคม", en: "For people not covered by social security" });
  }

  if (blocked) {
    level = "not";
    score = Math.max(5, score - 40);
  } else if (matchedSomething || Object.keys(rules).length === 0) {
    level = "eligible";
    if (!reasons.length) {
      reasons.push({ th: "เป็นสิทธิพื้นฐานที่คนไทยทั่วไปใช้ได้", en: "A general benefit most people can use" });
    }
  }

  return { benefit, level, score: Math.min(100, score), reasons };
}

export function matchBenefits(benefits: BenefitRow[], profile: BenefitProfile | null): BenefitMatch[] {
  const order: Record<MatchLevel, number> = { eligible: 0, maybe: 1, not: 2 };
  return benefits
    .map((b) => matchBenefit(b, profile))
    .sort((a, b) => order[a.level] - order[b.level] || b.score - a.score);
}
