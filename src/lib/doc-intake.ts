import { supabase } from "@/integrations/supabase/client";
import { categoryLabels, type Lang } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n.dict";
import { bangkokDateAtHour, todayInBangkok } from "@/lib/time";

export type DocAnalysisResult = {
  title: string;
  category: string;
  summary: string;
  docDate: string | null;
  dueDate: string | null;
  amount: number | null;
  counterparty: string | null;
  keyFacts: string[];
  suggestedReminderTitle: string | null;
  isExpense: boolean;
  isIncome: boolean;
  needsAction: boolean;
  isWarranty?: boolean;
  warrantyUntil?: string | null;
  /** kind and category arrive as plain strings; see normaliseLines. */
  lineItems?: Array<{
    title: string;
    amount: number;
    kind: string;
    on: string | null;
    category: string;
  }>;
};

type AnalyzeFn = (args: {
  data: { base64: string; mimeType: string; fileName: string; lang: Lang };
}) => Promise<DocAnalysisResult>;

export function fileToBase64(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export type IntakeResult = {
  analysis: DocAnalysisResult;
  routed: Array<"expense" | "income" | "reminder">;
  /** How many individual rows a multi-line document produced, 0 for a single-amount one. */
  lines: { expense: number; income: number };
};

/**
 * The "here is what I did with it" line, built once.
 *
 * Three pages reported this and each built the list by hand, so the line-count
 * wording would have had to be added in three places and kept in step there.
 */
export function routingNotes(
  result: Pick<IntakeResult, "routed" | "lines">,
  t: Pick<
    Dict,
    | "savedToDocs"
    | "routedToExpense"
    | "routedToIncome"
    | "routedToTasks"
    | "routedExpenseLines"
    | "routedIncomeLines"
  >,
): string[] {
  const notes = [t.savedToDocs];
  if (result.routed.includes("expense")) {
    notes.push(
      result.lines.expense > 1
        ? t.routedExpenseLines.replace("{n}", String(result.lines.expense))
        : t.routedToExpense,
    );
  }
  if (result.routed.includes("income")) {
    notes.push(
      result.lines.income > 1
        ? t.routedIncomeLines.replace("{n}", String(result.lines.income))
        : t.routedToIncome,
    );
  }
  if (result.routed.includes("reminder")) notes.push(t.routedToTasks);
  return notes;
}

const CATEGORY_KEYS = new Set(Object.keys(categoryLabels));

/**
 * The line items, with the two free-text fields pinned back to known values.
 *
 * They are strings in the schema because Gemini refused the version with
 * enums in it, so anything could come back. A category the app does not know
 * would render as a raw slug in the list, and a row that is neither "expense"
 * nor "income" has to land somewhere - money out is the safer guess for a
 * statement, and the user can flip it from the card.
 */
function normaliseLines(result: DocAnalysisResult) {
  return (result.lineItems ?? [])
    .filter((l) => Number.isFinite(Number(l.amount)) && Number(l.amount) > 0)
    .map((l) => ({
      title: String(l.title ?? "").trim() || result.title,
      amount: Number(l.amount),
      kind: String(l.kind ?? "").toLowerCase() === "income" ? "income" : "expense",
      on: /^\d{4}-\d{2}-\d{2}$/.test(String(l.on ?? "")) ? String(l.on) : null,
      category: CATEGORY_KEYS.has(String(l.category)) ? String(l.category) : result.category,
    }));
}

/** Thrown when the AI step fails; the row stays as status='failed' with its file so the user can retry or delete. */
export class DocumentAnalysisError extends Error {
  constructor(
    public readonly documentId: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "DocumentAnalysisError";
  }
}

/**
 * Uploads a file, lets Nong Phum read it, files it in the vault and routes it
 * into expenses / income / to-do automatically.
 *
 * Order matters: the documents row is created FIRST, as status='pending', and
 * only then is the file uploaded. Before this, upload came first, so an AI
 * failure left a file in the bucket with no row pointing at it — nothing in
 * the app could see it, and nothing could delete it. Now every file in the
 * bucket has a row from the moment it exists:
 *   upload fails   → the pending row is removed (nothing to keep)
 *   analysis fails → the row stays as 'failed' with the file, and the user
 *                    can retry or delete it from the Docs page
 */
export async function intakeDocument(
  file: File,
  analyze: AnalyzeFn,
  lang: Lang,
  userId: string,
): Promise<IntakeResult> {
  const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  const mimeType = file.type || "application/pdf";

  const { data: doc, error: insErr } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      title: file.name,
      status: "pending",
      kind: "analyzed",
      storage_path: path,
      mime_type: mimeType,
    })
    .select("id")
    .single();
  if (insErr) throw insErr;

  const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
  if (upErr) {
    // No file made it to the bucket, so the row has nothing to point at.
    await supabase.from("documents").delete().eq("id", doc.id);
    throw upErr;
  }

  return analyzeAndFinalize(doc.id, file, mimeType, file.name, analyze, lang, userId);
}

/**
 * Re-runs the AI step on a document whose analysis failed earlier. The file
 * is already in the bucket; it is downloaded again rather than trusting any
 * client-side copy.
 */
export async function retryDocument(
  documentId: string,
  analyze: AnalyzeFn,
  lang: Lang,
  userId: string,
): Promise<IntakeResult> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, title, storage_path, mime_type, status")
    .eq("id", documentId)
    .single();
  if (error) throw error;
  if (!doc.storage_path) throw new Error("document has no file to analyse");

  const { data: blob, error: dlErr } = await supabase.storage
    .from("documents")
    .download(doc.storage_path);
  if (dlErr || !blob) throw dlErr ?? new Error("could not download the file");

  await supabase.from("documents").update({ status: "pending" }).eq("id", doc.id);
  return analyzeAndFinalize(
    doc.id,
    blob,
    doc.mime_type ?? blob.type ?? "application/pdf",
    doc.title,
    analyze,
    lang,
    userId,
  );
}

async function analyzeAndFinalize(
  documentId: string,
  blob: Blob,
  mimeType: string,
  fileName: string,
  analyze: AnalyzeFn,
  lang: Lang,
  userId: string,
): Promise<IntakeResult> {
  let result: DocAnalysisResult;
  try {
    const base64 = await fileToBase64(blob);
    result = await analyze({ data: { base64, mimeType, fileName, lang } });
  } catch (cause) {
    // Keep the row and the file: the user decides whether to retry or delete.
    await supabase
      .from("documents")
      .update({
        status: "failed",
        summary: cause instanceof Error ? cause.message.slice(0, 500) : String(cause),
      })
      .eq("id", documentId);
    throw new DocumentAnalysisError(documentId, cause);
  }

  const warrantyUntil = result.warrantyUntil ?? (result.isWarranty ? result.dueDate : null);
  const { error: updErr } = await supabase
    .from("documents")
    .update({
      status: "ready",
      title: result.title,
      category: result.isWarranty ? "warranty" : result.category,
      summary: result.summary,
      doc_date: result.docDate,
      due_date: result.dueDate,
      amount: result.amount,
      counterparty: result.counterparty,
      is_warranty: !!result.isWarranty,
      warranty_until: warrantyUntil,
      extracted: JSON.parse(JSON.stringify(result)),
    })
    .eq("id", documentId);
  if (updErr) throw updErr;

  const today = todayInBangkok();
  const routed: IntakeResult["routed"] = [];
  const lineCounts = { expense: 0, income: 0 };

  // A statement lists many payments. Posting its total as one row loses every
  // line the user wrote down, which is the reason they keep the statement at
  // all - so when the AI found individual lines, those are what get filed and
  // the summary row is skipped.
  const lines = normaliseLines(result);
  if (lines.length > 0) {
    const expenses = lines.filter((l) => l.kind === "expense");
    const incomes = lines.filter((l) => l.kind === "income");
    if (expenses.length > 0) {
      const { error } = await supabase.from("expenses").insert(
        expenses.map((l) => ({
          user_id: userId,
          title: l.title,
          amount: l.amount,
          category: l.category || result.category,
          spent_on: l.on ?? result.docDate ?? today,
          source_document_id: documentId,
        })),
      );
      if (!error) {
        routed.push("expense");
        lineCounts.expense = expenses.length;
      }
    }
    if (incomes.length > 0) {
      const { error } = await supabase.from("incomes").insert(
        incomes.map((l) => ({
          user_id: userId,
          title: l.title,
          amount: l.amount,
          category: l.category || result.category,
          received_on: l.on ?? result.docDate ?? today,
          source_document_id: documentId,
        })),
      );
      if (!error) {
        routed.push("income");
        lineCounts.income = incomes.length;
      }
    }
  } else if (result.isIncome && result.amount) {
    await supabase.from("incomes").insert({
      user_id: userId,
      title: result.title,
      amount: result.amount,
      category: result.category,
      received_on: result.docDate ?? today,
      source_document_id: documentId,
    });
    routed.push("income");
  } else if (result.isExpense && result.amount) {
    await supabase.from("expenses").insert({
      user_id: userId,
      title: result.title,
      amount: result.amount,
      category: result.category,
      spent_on: result.docDate ?? today,
      source_document_id: documentId,
    });
    routed.push("expense");
  }

  if (result.needsAction && (result.dueDate || result.suggestedReminderTitle)) {
    await supabase.from("reminders").insert({
      user_id: userId,
      title: result.suggestedReminderTitle ?? result.title,
      due_at: result.dueDate ? bangkokDateAtHour(result.dueDate, 9) : null,
      priority: "high",
      source_document_id: documentId,
    });
    routed.push("reminder");
  }

  // Warranty expiry → reminder ~30 days before end (or on end date if closer)
  if (result.isWarranty && warrantyUntil) {
    const end = new Date(warrantyUntil + "T00:00:00+07:00");
    const remind = new Date(end);
    remind.setDate(remind.getDate() - 30);
    const remindStr = remind.toISOString().slice(0, 10);
    await supabase.from("reminders").insert({
      user_id: userId,
      title: `หมดประกัน: ${result.title}`,
      notes: `วันสิ้นสุดประกัน ${warrantyUntil}`,
      due_at: bangkokDateAtHour(remindStr < warrantyUntil ? remindStr : warrantyUntil, 9),
      priority: "normal",
      source_document_id: documentId,
    });
    routed.push("reminder");
  }

  return { analysis: result, routed, lines: lineCounts };
}
