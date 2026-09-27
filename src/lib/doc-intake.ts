import { supabase } from "@/integrations/supabase/client";
import { categoryLabels, type Lang } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n.dict";
import { bangkokDateAtHour, bangkokDateTime, todayInBangkok } from "@/lib/time";

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

/**
 * SHA-256 of a file's bytes, lowercase hex.
 *
 * What identifies an upload. The name does not: a phone saving the same scan
 * twice produces Notes_001932.pdf and Notes_001933.pdf, and two different
 * receipts can share a name.
 */
export async function fileHash(blob: Blob): Promise<string | null> {
  try {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Not available over plain http, and not worth failing an upload over.
    return null;
  }
}

/** A document of this user's with the same bytes, already filed. */
export type DuplicateUpload = { id: string; title: string; createdAt: string };

export class DuplicateDocumentError extends Error {
  constructor(public readonly existing: DuplicateUpload) {
    super("app:document_duplicate");
    this.name = "DuplicateDocumentError";
  }
}

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
 * Money rows from a document, stamped with a time as well as a day.
 *
 * The rule everywhere else in the app is that a time nobody stated is the
 * time of saving - which is what the chat does. Rows filed from a document
 * skipped it and carried a day alone, so their cards showed no time while
 * every other card did. The document says which day; the clock says when it
 * was filed, and that is the honest answer to "when was this recorded".
 *
 * The retry without the column is for the window between a deploy and its
 * migration: losing the entry is worse than losing the time of day.
 */
async function insertWithTime(
  table: "expenses" | "incomes",
  rows: Array<Record<string, unknown>>,
  dayColumn: "spent_on" | "received_on",
  timeColumn: "spent_at" | "received_at",
): Promise<boolean> {
  const withTime = rows.map((r) => ({
    ...r,
    [timeColumn]: bangkokDateTime(String(r[dayColumn] ?? ""), null),
  }));
  const first = await supabase.from(table).insert(withTime as never);
  if (!first.error) return true;
  if (first.error.code === "PGRST204" || first.error.code === "42703") {
    const second = await supabase.from(table).insert(rows as never);
    return !second.error;
  }
  return false;
}

/**
 * A date for money that has already moved.
 *
 * The handwritten note that prompted this wrote "25/09" with no year, and the
 * model filled the gap with 2028 - two years of expenses that would never
 * appear in "this month" and would quietly skew every total. A payment cannot
 * have happened in the future, so a future date is a misread rather than a
 * fact: the same day in the current year is tried, then the year before.
 * A Buddhist year passed through verbatim (2569) is handled first, since it
 * is 543 years out and would fail the same test for the wrong reason.
 *
 * Only for spent_on / received_on. A due date in the future is perfectly
 * normal and is left alone.
 */
export function moneyDate(raw: string | null | undefined, today: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const [, ys, mo, d] = m as unknown as [string, string, string, string];
  const year = Number(ys) >= 2400 ? Number(ys) - 543 : Number(ys);
  const asWritten = `${String(year).padStart(4, "0")}-${mo}-${d}`;
  if (asWritten <= today) return asWritten;
  const thisYear = `${today.slice(0, 4)}-${mo}-${d}`;
  if (thisYear <= today) return thisYear;
  return `${Number(today.slice(0, 4)) - 1}-${mo}-${d}`;
}

/**
 * The line items, with the two free-text fields pinned back to known values.
 *
 * They are strings in the schema because Gemini refused the version with
 * enums in it, so anything could come back. A category the app does not know
 * would render as a raw slug in the list, and a row that is neither "expense"
 * nor "income" has to land somewhere - money out is the safer guess for a
 * statement, and the user can flip it from the card.
 */
function normaliseLines(result: DocAnalysisResult, today: string) {
  return (result.lineItems ?? [])
    .filter((l) => Number.isFinite(Number(l.amount)) && Number(l.amount) > 0)
    .map((l) => ({
      title: String(l.title ?? "").trim() || result.title,
      amount: Number(l.amount),
      kind: String(l.kind ?? "").toLowerCase() === "income" ? "income" : "expense",
      on: moneyDate(l.on, today),
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

  // Before anything is written: the same bytes filed before means the money
  // rows already exist, and filing them again is what silently doubled the
  // totals. The caller decides what to say; nothing here is created.
  const hash = await fileHash(file);
  if (hash) {
    // content_hash arrives by migration and is not in the generated types
    // yet, so this one filter is applied untyped.
    const q = supabase
      .from("documents")
      .select("id, title, created_at")
      .eq("user_id", userId)
      .eq("status", "ready") as unknown as {
      eq: (
        column: string,
        value: string,
      ) => {
        limit: (n: number) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        };
      };
    };
    const { data: same } = await q.eq("content_hash", hash).limit(1).maybeSingle();
    if (same) {
      throw new DuplicateDocumentError({
        id: String(same["id"]),
        title: String(same["title"] ?? file.name),
        createdAt: String(same["created_at"] ?? ""),
      });
    }
  }

  const { data: doc, error: insErr } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      title: file.name,
      status: "pending",
      kind: "analyzed",
      storage_path: path,
      mime_type: mimeType,
      ...(hash ? { content_hash: hash } : {}),
    } as never)
    .select("id")
    .single();
  if (insErr) {
    // PGRST204 / 42703: the column arrives by migration and the site deploys
    // first. Losing the upload would be worse than losing the check.
    if (insErr.code === "PGRST204" || insErr.code === "42703") {
      const retry = await supabase
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
      if (retry.error) throw retry.error;
      return finishUpload(retry.data.id as string, file, path, mimeType, analyze, lang, userId);
    }
    throw insErr;
  }

  return finishUpload(doc.id as string, file, path, mimeType, analyze, lang, userId);
}

async function finishUpload(
  documentId: string,
  file: File,
  path: string,
  mimeType: string,
  analyze: AnalyzeFn,
  lang: Lang,
  userId: string,
): Promise<IntakeResult> {
  const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
  if (upErr) {
    // No file made it to the bucket, so the row has nothing to point at.
    await supabase.from("documents").delete().eq("id", documentId);
    throw upErr;
  }
  return analyzeAndFinalize(documentId, file, mimeType, file.name, analyze, lang, userId);
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

  // Retrying a document that already produced money rows would produce them
  // again - the retry path re-runs this whole function. The hash check ahead
  // of the upload catches a re-sent file; this catches everything else,
  // because the rows a document created are findable from the document.
  const [{ count: hasExpenses }, { count: hasIncomes }] = await Promise.all([
    supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("source_document_id", documentId),
    supabase
      .from("incomes")
      .select("id", { count: "exact", head: true })
      .eq("source_document_id", documentId),
  ]);
  const alreadyFiled = (hasExpenses ?? 0) > 0 || (hasIncomes ?? 0) > 0;

  // A statement lists many payments. Posting its total as one row loses every
  // line the user wrote down, which is the reason they keep the statement at
  // all - so when the AI found individual lines, those are what get filed and
  // the summary row is skipped.
  const lines = alreadyFiled ? [] : normaliseLines(result, today);
  if (lines.length > 0) {
    const expenses = lines.filter((l) => l.kind === "expense");
    const incomes = lines.filter((l) => l.kind === "income");
    if (expenses.length > 0) {
      const rows = expenses.map((l) => ({
        user_id: userId,
        title: l.title,
        amount: l.amount,
        category: l.category || result.category,
        spent_on: l.on ?? moneyDate(result.docDate, today) ?? today,
        source_document_id: documentId,
      }));
      const ok = await insertWithTime("expenses", rows, "spent_on", "spent_at");
      if (ok) {
        routed.push("expense");
        lineCounts.expense = expenses.length;
      }
    }
    if (incomes.length > 0) {
      const rows = incomes.map((l) => ({
        user_id: userId,
        title: l.title,
        amount: l.amount,
        category: l.category || result.category,
        received_on: l.on ?? moneyDate(result.docDate, today) ?? today,
        source_document_id: documentId,
      }));
      const ok = await insertWithTime("incomes", rows, "received_on", "received_at");
      if (ok) {
        routed.push("income");
        lineCounts.income = incomes.length;
      }
    }
  } else if (!alreadyFiled && result.isIncome && result.amount) {
    await insertWithTime(
      "incomes",
      [
        {
          user_id: userId,
          title: result.title,
          amount: result.amount,
          category: result.category,
          received_on: moneyDate(result.docDate, today) ?? today,
          source_document_id: documentId,
        },
      ],
      "received_on",
      "received_at",
    );
    routed.push("income");
  } else if (!alreadyFiled && result.isExpense && result.amount) {
    await insertWithTime(
      "expenses",
      [
        {
          user_id: userId,
          title: result.title,
          amount: result.amount,
          category: result.category,
          spent_on: moneyDate(result.docDate, today) ?? today,
          source_document_id: documentId,
        },
      ],
      "spent_on",
      "spent_at",
    );
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
