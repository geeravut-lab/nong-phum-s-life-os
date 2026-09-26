export const BENEFIT_GROUPS = [
  "elderly",
  "disabled",
  "low_income",
  "student",
  "farmer",
  "freelance",
  "unemployed",
  "parent",
  "pregnant",
] as const;

export type BenefitGroup = (typeof BENEFIT_GROUPS)[number];

export type BenefitEligibility = {
  min_age?: number;
  max_age?: number;
  max_monthly_income?: number;
  max_annual_income?: number;
  groups?: BenefitGroup[];
  requires_social_security?: boolean;
  requires_no_social_security?: boolean;
  requires_welfare_card?: boolean;
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
  eligibility: BenefitEligibility;
  is_active: boolean;
  deadline_month?: number | null;
  deadline_day?: number | null;
  deadline_note?: string | null;
  source_name?: string | null;
  verified_at?: string | null;
};

export type BenefitProfile = {
  birth_year: number | null;
  monthly_income: number | null;
  occupation: string | null;
  province: string | null;
  household_size: number | null;
  groups: BenefitGroup[];
  has_social_security: boolean;
  has_welfare_card: boolean;
};

export type MatchLevel = "eligible" | "maybe" | "not";

export type BenefitMatch = {
  benefit: BenefitRow;
  level: MatchLevel;
  reasons: Array<{ th: string; en: string }>;
};

export function benefitTitle(b: BenefitRow, lang: string) {
  return lang === "en" && b.title_en ? b.title_en : b.title;
}

export function pickLabel(lang: string, th: string, en: string) {
  return lang === "en" ? en : th;
}

export function localized(lang: string, pair: { th: string; en: string }) {
  return lang === "en" ? pair.en : pair.th;
}

export const benefitCategoryLabels: Record<string, { th: string; en: string }> = {
  elderly: { th: "ผู้สูงอายุ", en: "Elderly" },
  health: { th: "สุขภาพ", en: "Health" },
  tax: { th: "ภาษี", en: "Tax" },
  education: { th: "การศึกษา", en: "Education" },
  agriculture: { th: "เกษตร", en: "Agriculture" },
  work: { th: "งาน", en: "Work" },
  housing: { th: "ที่อยู่อาศัย", en: "Housing" },
  other: { th: "อื่น ๆ", en: "Other" },
};

export const groupLabels: Record<BenefitGroup, { th: string; en: string }> = {
  elderly: { th: "ผู้สูงอายุ", en: "Elderly" },
  disabled: { th: "ผู้พิการ", en: "Disabled" },
  low_income: { th: "รายได้น้อย", en: "Low income" },
  student: { th: "นักเรียน/นักศึกษา", en: "Student" },
  farmer: { th: "เกษตรกร", en: "Farmer" },
  freelance: { th: "อาชีพอิสระ", en: "Freelance" },
  unemployed: { th: "ว่างงาน", en: "Unemployed" },
  parent: { th: "พ่อแม่/ผู้ปกครอง", en: "Parent" },
  pregnant: { th: "ตั้งครรภ์", en: "Pregnant" },
};

function ageFromBirthYear(birthYear: number | null): number | null {
  if (birthYear == null) return null;
  return new Date().getFullYear() - birthYear;
}

export function matchBenefits(
  benefits: BenefitRow[],
  profile: BenefitProfile | null,
): BenefitMatch[] {
  return benefits
    .map((benefit) => scoreOne(benefit, profile))
    .sort((a, b) => {
      const order = { eligible: 0, maybe: 1, not: 2 } as const;
      return order[a.level] - order[b.level];
    });
}

function scoreOne(benefit: BenefitRow, profile: BenefitProfile | null): BenefitMatch {
  const el = benefit.eligibility ?? {};
  const reasons: BenefitMatch["reasons"] = [];
  if (!profile) {
    return { benefit, level: "maybe", reasons: [{ th: "ยังไม่มีโปรไฟล์", en: "No profile yet" }] };
  }

  let hardFail = false;
  let soft = 0;
  const age = ageFromBirthYear(profile.birth_year);

  if (el.min_age != null) {
    if (age == null) soft++;
    else if (age < el.min_age) {
      hardFail = true;
      reasons.push({ th: `อายุขั้นต่ำ ${el.min_age}`, en: `Min age ${el.min_age}` });
    }
  }
  if (el.max_age != null) {
    if (age == null) soft++;
    else if (age > el.max_age) {
      hardFail = true;
      reasons.push({ th: `อายุไม่เกิน ${el.max_age}`, en: `Max age ${el.max_age}` });
    }
  }
  if (el.max_monthly_income != null) {
    if (profile.monthly_income == null) soft++;
    else if (profile.monthly_income > el.max_monthly_income) {
      hardFail = true;
      reasons.push({
        th: `รายได้ต่อเดือนไม่เกิน ${el.max_monthly_income.toLocaleString()}`,
        en: `Monthly income ≤ ${el.max_monthly_income.toLocaleString()}`,
      });
    }
  }
  if (el.max_annual_income != null) {
    const annual = profile.monthly_income != null ? profile.monthly_income * 12 : null;
    if (annual == null) soft++;
    else if (annual > el.max_annual_income) {
      hardFail = true;
      reasons.push({
        th: `รายได้ต่อปีไม่เกิน ${el.max_annual_income.toLocaleString()}`,
        en: `Annual income ≤ ${el.max_annual_income.toLocaleString()}`,
      });
    }
  }
  if (el.requires_social_security) {
    if (!profile.has_social_security) {
      hardFail = true;
      reasons.push({ th: "ต้องมีประกันสังคม", en: "Requires social security" });
    }
  }
  if (el.requires_no_social_security) {
    if (profile.has_social_security) {
      hardFail = true;
      reasons.push({ th: "สำหรับผู้ไม่มีประกันสังคม", en: "For those without SSO" });
    }
  }
  if (el.requires_welfare_card) {
    if (!profile.has_welfare_card) {
      hardFail = true;
      reasons.push({ th: "ต้องมีบัตรสวัสดิการแห่งรัฐ", en: "Requires welfare card" });
    }
  }
  if (el.groups?.length) {
    const hit = el.groups.some((g) => profile.groups.includes(g));
    if (!hit) {
      if (profile.groups.length === 0) soft++;
      else {
        hardFail = true;
        reasons.push({ th: "กลุ่มเป้าหมายไม่ตรง", en: "Target group mismatch" });
      }
    } else {
      reasons.push({ th: "เข้ากลุ่มเป้าหมาย", en: "Matches target group" });
    }
  }

  if (hardFail) return { benefit, level: "not", reasons };
  if (soft > 0 || reasons.length === 0) {
    if (soft > 0) {
      reasons.push({ th: "ข้อมูลบางส่วนยังไม่ครบ", en: "Some profile fields missing" });
    }
    return { benefit, level: "maybe", reasons };
  }
  return { benefit, level: "eligible", reasons };
}

/** Next calendar date for a benefit deadline (month/day), or null. */
export function nextDeadlineDate(benefit: BenefitRow, from: Date = new Date()): Date | null {
  if (benefit.deadline_month == null) return null;
  const day = benefit.deadline_day ?? 1;
  const y = from.getFullYear();
  let d = new Date(y, benefit.deadline_month - 1, day, 12, 0, 0);
  if (d.getTime() < from.getTime()) {
    d = new Date(y + 1, benefit.deadline_month - 1, day, 12, 0, 0);
  }
  return d;
}

export type DeadlineItem = {
  benefit: BenefitRow;
  date: Date | null;
  note: string | null;
  daysLeft: number | null;
};

/** Upcoming deadlines for matched (eligible/maybe) benefits + any with notes. */
export function upcomingDeadlines(matches: BenefitMatch[], limit = 8): DeadlineItem[] {
  const now = new Date();
  const items: DeadlineItem[] = [];
  for (const m of matches) {
    if (m.level === "not") continue;
    const b = m.benefit;
    if (!b.deadline_month && !b.deadline_note) continue;
    const date = nextDeadlineDate(b, now);
    const daysLeft =
      date != null ? Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null;
    items.push({ benefit: b, date, note: b.deadline_note ?? null, daysLeft });
  }
  items.sort((a, b) => {
    if (a.date && b.date) return a.date.getTime() - b.date.getTime();
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
  return items.slice(0, limit);
}
