import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function bangkokDateAtHour(ymd: string, hour: number): string {
  const h = String(hour).padStart(2, "0");
  return `${ymd}T${h}:00:00+07:00`;
}

/** Serializable payload for legacy import (no unknown). */
export type LegacyImportPayload = {
  kind?: string;
  title?: string;
  notes?: string;
  location_hint?: string;
  estimated_value?: number | null;
  full_name?: string;
  relation?: string;
  priority?: number;
  is_verifier?: boolean;
  personal_message?: string;
  section?: string;
  body?: string;
};

export type LegacyImportCandidate = {
  key: string;
  source: "money" | "family" | "benefits" | "docs";
  target: "asset" | "contact" | "wish" | "checklist";
  title: string;
  detail: string;
  payload: LegacyImportPayload;
};

const ImportItemSchema = z.object({
  target: z.enum(["asset", "contact", "wish", "checklist"]),
  payload: z.object({
    kind: z.string().optional(),
    title: z.string().optional(),
    notes: z.string().optional(),
    location_hint: z.string().optional(),
    estimated_value: z.number().nullable().optional(),
    full_name: z.string().optional(),
    relation: z.string().optional(),
    priority: z.number().optional(),
    is_verifier: z.boolean().optional(),
    personal_message: z.string().optional(),
    section: z.string().optional(),
    body: z.string().optional(),
  }),
});

/** Create missing reminders for documents with due_date / warranty_until. */
export const syncDocumentExpirations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const uid = context.userId;
    const { data: docs, error } = await supabaseAdmin
      .from("documents")
      .select("id, title, due_date, warranty_until, is_warranty, kind")
      .eq("user_id", uid)
      .eq("kind", "analyzed")
      .or("due_date.not.is.null,warranty_until.not.is.null");
    if (error) throw new Error(error.message);

    let created = 0;
    for (const d of docs ?? []) {
      const targets: Array<{ date: string; title: string }> = [];
      if (d.due_date) {
        targets.push({
          date: d.due_date as string,
          title: `ครบกำหนดเอกสาร: ${d.title}`,
        });
      }
      if (d.warranty_until) {
        const end = d.warranty_until as string;
        const endD = new Date(end + "T00:00:00+07:00");
        const remind = new Date(endD);
        remind.setDate(remind.getDate() - 30);
        const remindYmd = remind.toISOString().slice(0, 10);
        targets.push({
          date: remindYmd <= end ? remindYmd : end,
          title: `หมดประกัน: ${d.title}`,
        });
      }

      for (const t of targets) {
        const { data: existing } = await supabaseAdmin
          .from("reminders")
          .select("id")
          .eq("user_id", uid)
          .eq("source_document_id", d.id)
          .eq("title", t.title)
          .maybeSingle();
        if (existing) continue;

        const { error: insErr } = await supabaseAdmin.from("reminders").insert({
          user_id: uid,
          title: t.title,
          notes: `จากเอกสารในคลัง · วันอ้างอิง ${t.date}`,
          due_at: bangkokDateAtHour(t.date, 9),
          priority: d.is_warranty ? "normal" : "high",
          source_document_id: d.id as string,
          status: "open",
        });
        if (!insErr) created += 1;
      }
    }

    return { scanned: (docs ?? []).length, created };
  });

/** Scan Money / Family / Benefits / Docs for items that can fill the legacy plan. */
export const suggestLegacyFromLifeOs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const uid = context.userId;
    const candidates: LegacyImportCandidate[] = [];

    const [{ data: assets }, { data: contacts }, { data: wishes }, { data: checklist }] =
      await Promise.all([
        supabaseAdmin.from("legacy_assets").select("title").eq("user_id", uid),
        supabaseAdmin.from("legacy_contacts").select("full_name").eq("user_id", uid),
        supabaseAdmin.from("legacy_wishes").select("title, section").eq("user_id", uid),
        supabaseAdmin.from("legacy_checklist").select("title").eq("user_id", uid),
      ]);

    const assetTitles = new Set((assets ?? []).map((a) => (a.title as string).toLowerCase()));
    const contactNames = new Set(
      (contacts ?? []).map((c) => (c.full_name as string).toLowerCase()),
    );
    const wishTitles = new Set((wishes ?? []).map((w) => (w.title as string).toLowerCase()));
    const checkTitles = new Set(
      (checklist ?? []).map((c) => (c.title as string).toLowerCase()),
    );

    const { data: expenses } = await supabaseAdmin
      .from("expenses")
      .select("id, title, amount, category, spent_on")
      .eq("user_id", uid)
      .order("spent_on", { ascending: false })
      .limit(30);

    const expByTitle = new Map<string, { amount: number; category: string; count: number }>();
    for (const e of expenses ?? []) {
      const k = ((e.title as string) || "").trim();
      if (!k) continue;
      const prev = expByTitle.get(k) ?? {
        amount: 0,
        category: (e.category as string) || "other",
        count: 0,
      };
      prev.amount = Math.max(prev.amount, Number(e.amount) || 0);
      prev.count += 1;
      expByTitle.set(k, prev);
    }
    for (const [title, v] of expByTitle) {
      if (v.count < 2 && v.amount < 3000) continue;
      if (assetTitles.has(title.toLowerCase())) continue;
      candidates.push({
        key: `money-exp-${title}`,
        source: "money",
        target: "asset",
        title,
        detail: `พบรายจ่ายซ้ำ/สำคัญ · หมวด ${v.category} · ~฿${v.amount.toLocaleString()}`,
        payload: {
          kind: v.category === "finance" || v.category === "bill" ? "debt" : "other",
          title,
          notes: `นำเข้าจาก Money · เห็น ${v.count} ครั้ง`,
          estimated_value: v.amount,
        },
      });
    }

    const { data: membership } = await supabaseAdmin
      .from("family_members")
      .select("family_id, display_name, member_role, user_id")
      .eq("user_id", uid)
      .maybeSingle();

    if (membership?.family_id) {
      const { data: members } = await supabaseAdmin
        .from("family_members")
        .select("user_id, display_name, member_role")
        .eq("family_id", membership.family_id);
      for (const m of members ?? []) {
        if (m.user_id === uid) continue;
        const name =
          (m.display_name as string)?.trim() ||
          `สมาชิกครอบครัว (${(m.member_role as string) || "member"})`;
        if (contactNames.has(name.toLowerCase())) continue;
        candidates.push({
          key: `family-${m.user_id}`,
          source: "family",
          target: "contact",
          title: name,
          detail: `จากครอบครัว · บทบาท ${(m.member_role as string) || "member"}`,
          payload: {
            full_name: name,
            relation: (m.member_role as string) || "family",
            priority: 2,
            is_verifier: false,
            personal_message: "",
          },
        });
      }
    }

    const { data: savedBenefits } = await supabaseAdmin
      .from("user_benefits")
      .select("id, benefit_id, notes")
      .eq("user_id", uid)
      .limit(20);
    if (savedBenefits?.length) {
      const ids = savedBenefits.map((b) => b.benefit_id as string).filter(Boolean);
      const { data: benefitRows } = ids.length
        ? await supabaseAdmin
            .from("benefits")
            .select("id, title, title_en, provider")
            .in("id", ids)
        : { data: [] as Array<{ id: string; title: string; provider: string }> };
      const byId = new Map((benefitRows ?? []).map((b) => [b.id as string, b]));
      for (const sb of savedBenefits) {
        const b = byId.get(sb.benefit_id as string);
        const title = (b?.title as string) || "สิทธิที่บันทึกไว้";
        if (wishTitles.has(title.toLowerCase()) || checkTitles.has(title.toLowerCase())) {
          continue;
        }
        candidates.push({
          key: `benefit-${sb.id}`,
          source: "benefits",
          target: "checklist",
          title: `ติดต่อสิทธิ: ${title}`,
          detail: b?.provider ? `หน่วยงาน ${b.provider}` : "จากสิทธิฉัน",
          payload: {
            title: `ติดต่อสิทธิ: ${title}`,
            notes: (sb.notes as string) || "",
          },
        });
      }
    }

    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select(
        "id, title, category, summary, due_date, warranty_until, is_warranty, counterparty",
      )
      .eq("user_id", uid)
      .eq("kind", "analyzed")
      .in("category", ["insurance", "government", "finance", "warranty", "vehicle", "home"])
      .limit(40);

    for (const d of docs ?? []) {
      const title = (d.title as string) || "เอกสาร";
      if (d.is_warranty || d.category === "warranty") {
        if (assetTitles.has(title.toLowerCase())) continue;
        candidates.push({
          key: `doc-w-${d.id}`,
          source: "docs",
          target: "asset",
          title,
          detail: `ประกันสินค้า · หมด ${d.warranty_until || d.due_date || "—"}`,
          payload: {
            kind: "other",
            title,
            notes: `${d.summary || ""}\nWarranty until: ${d.warranty_until || d.due_date || ""}`.trim(),
            location_hint: (d.counterparty as string) || "",
          },
        });
      } else if (d.category === "insurance") {
        if (assetTitles.has(title.toLowerCase())) continue;
        candidates.push({
          key: `doc-ins-${d.id}`,
          source: "docs",
          target: "asset",
          title,
          detail: `เอกสารประกัน · คู่สัญญา ${d.counterparty || "—"}`,
          payload: {
            kind: "insurance",
            title,
            notes: (d.summary as string) || "",
            location_hint: (d.counterparty as string) || "",
          },
        });
      } else if (d.due_date && !checkTitles.has(`ต่ออายุ: ${title}`.toLowerCase())) {
        candidates.push({
          key: `doc-due-${d.id}`,
          source: "docs",
          target: "checklist",
          title: `ต่ออายุ/จัดการ: ${title}`,
          detail: `ครบกำหนด ${d.due_date}`,
          payload: {
            title: `ต่ออายุ/จัดการ: ${title}`,
            notes: (d.summary as string) || "",
          },
        });
      }
    }

    return { candidates: candidates.slice(0, 40) };
  });

/** Apply accepted import candidates into legacy tables. */
export const applyLegacyImports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        items: z.array(ImportItemSchema).min(1).max(30),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    let applied = 0;

    for (const item of data.items) {
      const p = item.payload;
      if (item.target === "asset") {
        const { error } = await supabaseAdmin.from("legacy_assets").insert({
          user_id: uid,
          kind: p.kind ?? "other",
          title: p.title ?? "รายการ",
          details: p.notes ?? "",
          location_hint: p.location_hint ?? "",
          estimated_value:
            typeof p.estimated_value === "number" ? p.estimated_value : null,
          is_liability: (p.kind ?? "") === "debt",
        });
        if (!error) applied += 1;
      } else if (item.target === "contact") {
        const { error } = await supabaseAdmin.from("legacy_contacts").insert({
          user_id: uid,
          full_name: p.full_name ?? "ผู้ติดต่อ",
          relation: p.relation ?? "",
          priority: p.priority ?? 3,
          is_verifier: p.is_verifier ?? false,
          personal_message: p.personal_message ?? "",
        });
        if (!error) applied += 1;
      } else if (item.target === "wish") {
        const { error } = await supabaseAdmin.from("legacy_wishes").insert({
          user_id: uid,
          section: p.section ?? "final_wishes",
          title: p.title ?? "",
          body: p.body ?? p.notes ?? "",
        });
        if (!error) applied += 1;
      } else if (item.target === "checklist") {
        const { error } = await supabaseAdmin.from("legacy_checklist").insert({
          user_id: uid,
          title: p.title ?? "",
          notes: p.notes ?? "",
          is_done: false,
          sort_order: 100 + applied,
        });
        if (!error) applied += 1;
      }
    }

    return { applied };
  });
