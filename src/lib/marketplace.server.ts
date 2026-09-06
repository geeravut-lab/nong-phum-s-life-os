import { generateObject } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persona } from "./ai-gateway.server";
import { withProviderFallback } from "./ai-provider.server";

export const JOB_CATEGORIES = [
  "buy_deliver",
  "delivery",
  "pet_care",
  "elder_care",
  "assembly",
  "photography",
  "paperwork",
  "tech_help",
  "computer_work",
  "moving",
  "repair",
  "cleaning",
  "admin",
  "event",
  "other",
] as const;

const JobDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.enum(JOB_CATEGORIES),
  locationText: z.string().nullable(),
  scheduledAt: z.string().nullable().describe("ISO 8601 datetime or null"),
  budgetMin: z.number().nullable(),
  budgetMax: z.number().nullable(),
  followUpQuestions: z.array(z.string()).max(3),
  neededSkills: z.array(z.string()).max(6),
});

export type JobDraft = z.infer<typeof JobDraftSchema>;

/** Turns a plain-language problem statement into a structured job. */
export async function draftJobFromText(input: { message: string; lang: "th" | "en" }): Promise<JobDraft> {
  const langName = input.lang === "en" ? "English" : "Thai";
  const now = new Date().toISOString();

  const { object } = await withProviderFallback("chat", (model) =>
    generateObject({
      model,
      schema: JobDraftSchema,
      system: `${persona(input.lang)}
You turn a user's everyday problem into a concrete job request for a local helper marketplace in Thailand.
The user may not know what service they need — infer it (e.g. "washing machine has no water" -> appliance repair).
Write all free text in ${langName}. Current time: ${now}. Budget in THB, realistic for Thailand.
Ask at most 3 short follow-up questions only for details you truly cannot infer.`,
      prompt: input.message,
    }),
  );

  return object;
}

const SkillsSchema = z.object({
  skills: z.array(z.string()).max(12),
  bio: z.string(),
});

/** Builds a helper profile (skill tags + short bio) from a free-text self description. */
export async function draftHelperSkills(input: { text: string; lang: "th" | "en" }) {
  const langName = input.lang === "en" ? "English" : "Thai";
  const { object } = await withProviderFallback("chat", (model) =>
    generateObject({
      model,
      schema: SkillsSchema,
      system: `${persona(input.lang)}
You convert a person's description of what they can do into concise skill tags for a local helper marketplace.
Skill tags: 2-4 words each, in ${langName}. Bio: 1-2 friendly sentences in ${langName}.`,
      prompt: input.text,
    }),
  );
  return object;
}

type HelperRow = {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  skills: string[];
  area: string | null;
  lat: number | null;
  lng: number | null;
  available_from: string | null;
  available_to: string | null;
  hourly_rate: number | null;
  rating: number;
  jobs_done: number;
};

type JobRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  lat: number | null;
  lng: number | null;
  location_text: string | null;
  scheduled_at: string | null;
  budget_min: number | null;
  budget_max: number | null;
  ai_extract: unknown;
};

function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type HelperMatch = {
  helperId: string;
  displayName: string;
  bio: string | null;
  skills: string[];
  area: string | null;
  rating: number;
  jobsDone: number;
  hourlyRate: number | null;
  distanceKm: number | null;
  score: number;
};

/**
 * Match score weights from the spec:
 * skills 35 / distance 20 / availability 15 / price 10 / rating 10 / experience 10.
 */
export async function matchHelpersForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<HelperMatch[]> {
  const { data: job } = await supabase
    .from("jobs")
    .select("id,title,description,category,lat,lng,location_text,scheduled_at,budget_min,budget_max,ai_extract")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return [];
  const j = job as JobRow;

  const { data: helpers } = await supabase
    .from("helper_profiles")
    .select(
      "id,user_id,display_name,bio,skills,area,lat,lng,available_from,available_to,hourly_rate,rating,jobs_done",
    )
    .eq("is_active", true)
    .limit(200);

  const extract = (j.ai_extract ?? {}) as { neededSkills?: string[] };
  const needed = (extract.neededSkills ?? []).map((s) => s.toLowerCase());
  const haystack = `${j.title} ${j.description ?? ""} ${j.category}`.toLowerCase();
  const scheduledHour = j.scheduled_at ? new Date(j.scheduled_at).getHours() : null;
  const budgetMax = j.budget_max ?? j.budget_min;

  const matches: HelperMatch[] = ((helpers ?? []) as HelperRow[]).map((h) => {
    const tags = (h.skills ?? []).map((s) => s.toLowerCase());
    const hit = tags.filter((tag) => haystack.includes(tag) || needed.some((n) => n.includes(tag) || tag.includes(n)));
    const skillScore = tags.length ? Math.min(1, hit.length / Math.max(1, Math.min(3, needed.length || 2))) : 0;

    let distanceKm: number | null = null;
    if (j.lat != null && j.lng != null && h.lat != null && h.lng != null) {
      distanceKm = km(j.lat, j.lng, h.lat, h.lng);
    } else if (h.area && j.location_text) {
      distanceKm = h.area.trim() && j.location_text.includes(h.area.trim()) ? 3 : null;
    }
    const distScore = distanceKm == null ? 0.5 : Math.max(0, 1 - distanceKm / 20);

    let availScore = 0.5;
    if (scheduledHour != null && h.available_from && h.available_to) {
      const from = Number(h.available_from.slice(0, 2));
      const to = Number(h.available_to.slice(0, 2));
      availScore = scheduledHour >= from && scheduledHour <= to ? 1 : 0.2;
    }

    let priceScore = 0.5;
    if (budgetMax != null && h.hourly_rate != null) {
      priceScore = h.hourly_rate <= budgetMax ? 1 : Math.max(0, 1 - (h.hourly_rate - budgetMax) / budgetMax);
    }

    const ratingScore = h.rating > 0 ? Math.min(1, h.rating / 5) : 0.6;
    const expScore = Math.min(1, h.jobs_done / 50);

    const score =
      skillScore * 35 + distScore * 20 + availScore * 15 + priceScore * 10 + ratingScore * 10 + expScore * 10;

    return {
      helperId: h.id,
      displayName: h.display_name,
      bio: h.bio,
      skills: h.skills ?? [],
      area: h.area,
      rating: h.rating,
      jobsDone: h.jobs_done,
      hourlyRate: h.hourly_rate,
      distanceKm: distanceKm == null ? null : Math.round(distanceKm * 10) / 10,
      score: Math.round(score),
    };
  });

  return matches.sort((a, b) => b.score - a.score).slice(0, 10);
}
