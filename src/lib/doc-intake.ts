import { supabase } from "@/integrations/supabase/client";
import type { Lang } from "@/lib/i18n";
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
};

type AnalyzeFn = (args: {
  data: { base64: string; mimeType: string; fileName: string; lang: Lang };
}) => Promise<DocAnalysisResult>;

export function fileToBase64(file: File) {
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
};

/**
 * Uploads a file, lets Nong Phum read it, files it in the vault and routes it
 * into expenses / income / to-do automatically.
 */
export async function intakeDocument(
  file: File,
  analyze: AnalyzeFn,
  lang: Lang,
  userId: string,
): Promise<IntakeResult> {
  const base64 = await fileToBase64(file);
  const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;

  const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
  if (upErr) throw upErr;

  const result = await analyze({
    data: { base64, mimeType: file.type || "application/pdf", fileName: file.name, lang },
  });

  const { data: doc, error } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      title: result.title,
      category: result.category,
      summary: result.summary,
      doc_date: result.docDate,
      due_date: result.dueDate,
      amount: result.amount,
      counterparty: result.counterparty,
      storage_path: path,
      mime_type: file.type,
      extracted: JSON.parse(JSON.stringify(result)),
    })
    .select("id")
    .single();
  if (error) throw error;

  const today = todayInBangkok();
  const routed: IntakeResult["routed"] = [];

  if (result.isIncome && result.amount) {
    await supabase.from("incomes").insert({
      user_id: userId,
      title: result.title,
      amount: result.amount,
      category: result.category,
      received_on: result.docDate ?? today,
      source_document_id: doc.id,
    });
    routed.push("income");
  } else if (result.isExpense && result.amount) {
    await supabase.from("expenses").insert({
      user_id: userId,
      title: result.title,
      amount: result.amount,
      category: result.category,
      spent_on: result.docDate ?? today,
      source_document_id: doc.id,
    });
    routed.push("expense");
  }

  if (result.needsAction && (result.dueDate || result.suggestedReminderTitle)) {
    await supabase.from("reminders").insert({
      user_id: userId,
      title: result.suggestedReminderTitle ?? result.title,
      due_at: result.dueDate ? bangkokDateAtHour(result.dueDate, 9) : null,
      priority: "high",
      source_document_id: doc.id,
    });
    routed.push("reminder");
  }

  return { analysis: result, routed };
}
