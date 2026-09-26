import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Universal Search ("Ask My Life").
 *
 * The blueprint lists this among the five MVP functions: ask about your own
 * data in plain language and get an answer from across the modules, instead of
 * remembering which page a thing lives on.
 *
 * Runs on the server through supabaseAdmin because it reads across many
 * tables, so every query is scoped by user_id here - plus the family-shared
 * rows the user is entitled to see, matching how each module already decides
 * visibility (is_shared + family_id).
 */

export type SearchHit = {
  id: string;
  source: "document" | "task" | "expense" | "income" | "benefit" | "place" | "asset";
  title: string;
  detail: string;
  /** ISO date this hit is "about", for sorting and display. Null when undated. */
  date: string | null;
  href: string;
  shared: boolean;
};

export type SearchGroup = {
  source: SearchHit["source"];
  label: string;
  hits: SearchHit[];
};

const LABELS: Record<SearchHit["source"], { th: string; en: string }> = {
  document: { th: "เอกสาร", en: "Documents" },
  task: { th: "เรื่องที่ต้องทำ", en: "Tasks" },
  expense: { th: "รายจ่าย", en: "Expenses" },
  income: { th: "รายรับ", en: "Income" },
  benefit: { th: "สิทธิ", en: "Benefits" },
  place: { th: "ของดีใกล้บ้าน", en: "Local" },
  asset: { th: "ทรัพย์สินที่ฝากไว้", en: "Legacy assets" },
};

/** Escape a user string for use inside a PostgREST `or(...)` ilike pattern. */
function like(term: string): string {
  // Commas and parentheses would break out of the or() list; % and _ are
  // wildcards we do not want the user to inject accidentally.
  return term.replace(/[,()%_\\]/g, (c) => "\\" + c);
}

function trim(s: unknown, max = 160): string {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

export const universalSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        q: z.string().min(2).max(120),
        lang: z.enum(["th", "en"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    const lang = data.lang === "en" ? "en" : "th";
    const q = like(data.q.trim());
    const pat = `%${q}%`;
    const PER_SOURCE = 8;

    // Which family the user belongs to, so shared rows are searchable too.
    const { data: member } = await supabaseAdmin
      .from("family_members")
      .select("family_id")
      .eq("user_id", uid)
      .maybeSingle();
    const familyId = (member?.family_id as string | null) ?? null;

    /** own rows, or rows shared into the user's family */
    const visible = (col = "user_id") =>
      familyId
        ? `${col}.eq.${uid},and(is_shared.eq.true,family_id.eq.${familyId})`
        : `${col}.eq.${uid}`;

    const [docs, tasks, exp, inc, ben, places, assets] = await Promise.all([
      supabaseAdmin
        .from("documents")
        .select("id, title, summary, category, doc_date, due_date, is_shared")
        .or(visible())
        .or(`title.ilike.${pat},summary.ilike.${pat},category.ilike.${pat}`)
        .limit(PER_SOURCE),
      supabaseAdmin
        .from("reminders")
        .select("id, title, notes, due_at, status, is_shared")
        .or(visible())
        .or(`title.ilike.${pat},notes.ilike.${pat}`)
        .limit(PER_SOURCE),
      supabaseAdmin
        .from("expenses")
        .select("id, title, note, category, amount, spent_on, is_shared")
        .or(visible())
        .or(`title.ilike.${pat},note.ilike.${pat},category.ilike.${pat}`)
        .limit(PER_SOURCE),
      supabaseAdmin
        .from("incomes")
        .select("id, title, note, category, amount, received_on, is_shared")
        .or(visible())
        .or(`title.ilike.${pat},note.ilike.${pat},category.ilike.${pat}`)
        .limit(PER_SOURCE),
      // Benefits are a public catalogue, not per-user rows.
      supabaseAdmin
        .from("benefits")
        .select("id, title, title_en, summary, provider, slug, is_active")
        .eq("is_active", true)
        .or(`title.ilike.${pat},title_en.ilike.${pat},summary.ilike.${pat},provider.ilike.${pat}`)
        .limit(PER_SOURCE),
      supabaseAdmin
        .from("local_places")
        .select("id, name, name_en, description, area, category, is_active")
        .eq("is_active", true)
        .or(`name.ilike.${pat},name_en.ilike.${pat},description.ilike.${pat},area.ilike.${pat}`)
        .limit(PER_SOURCE),
      supabaseAdmin
        .from("legacy_assets")
        .select("id, title, details, kind, location_hint, user_id")
        .eq("user_id", uid)
        .or(`title.ilike.${pat},details.ilike.${pat},kind.ilike.${pat}`)
        .limit(PER_SOURCE),
    ]);

    const hits: SearchHit[] = [];

    for (const r of docs.data ?? []) {
      hits.push({
        id: r.id as string,
        source: "document",
        title: trim(r.title) || "—",
        detail: trim(r.summary) || trim(r.category),
        date: (r.doc_date as string | null) ?? (r.due_date as string | null) ?? null,
        href: "/docs",
        shared: !!r.is_shared,
      });
    }
    for (const r of tasks.data ?? []) {
      hits.push({
        id: r.id as string,
        source: "task",
        title: trim(r.title) || "—",
        detail: trim(r.notes) || (r.status as string),
        date: (r.due_at as string | null) ?? null,
        href: "/tasks",
        shared: !!r.is_shared,
      });
    }
    for (const r of exp.data ?? []) {
      hits.push({
        id: r.id as string,
        source: "expense",
        title: trim(r.title) || trim(r.category) || "—",
        detail: [r.amount != null ? `฿${r.amount}` : "", trim(r.note)].filter(Boolean).join(" · "),
        date: (r.spent_on as string | null) ?? null,
        href: "/money",
        shared: !!r.is_shared,
      });
    }
    for (const r of inc.data ?? []) {
      hits.push({
        id: r.id as string,
        source: "income",
        title: trim(r.title) || trim(r.category) || "—",
        detail: [r.amount != null ? `฿${r.amount}` : "", trim(r.note)].filter(Boolean).join(" · "),
        date: (r.received_on as string | null) ?? null,
        href: "/money",
        shared: !!r.is_shared,
      });
    }
    for (const r of ben.data ?? []) {
      hits.push({
        id: r.id as string,
        source: "benefit",
        title: trim(lang === "en" ? r.title_en || r.title : r.title) || "—",
        detail: trim(r.summary) || trim(r.provider),
        date: null,
        href: "/benefits",
        shared: false,
      });
    }
    for (const r of places.data ?? []) {
      hits.push({
        id: r.id as string,
        source: "place",
        title: trim(lang === "en" ? r.name_en || r.name : r.name) || "—",
        detail: trim(r.description) || trim(r.area),
        date: null,
        href: "/local",
        shared: false,
      });
    }
    for (const r of assets.data ?? []) {
      hits.push({
        id: r.id as string,
        source: "asset",
        title: trim(r.title) || "—",
        detail: trim(r.details) || trim(r.location_hint),
        date: null,
        href: "/legacy",
        shared: false,
      });
    }

    // Group in a stable order, newest first inside each group.
    const order: SearchHit["source"][] = [
      "task",
      "document",
      "expense",
      "income",
      "asset",
      "benefit",
      "place",
    ];
    const groups: SearchGroup[] = [];
    for (const source of order) {
      const g = hits.filter((h) => h.source === source);
      if (g.length === 0) continue;
      g.sort((a, b) => {
        if (a.date && b.date) return b.date.localeCompare(a.date);
        if (a.date) return -1;
        if (b.date) return 1;
        return a.title.localeCompare(b.title);
      });
      groups.push({ source, label: LABELS[source][lang], hits: g });
    }

    return { groups, total: hits.length, query: data.q.trim() };
  });
