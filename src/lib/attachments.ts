import { supabase } from "@/integrations/supabase/client";

// Phase 1.9: a receipt (or any file) attached to an expense, an income or a
// reminder. Design decided in 1.2 ("ทางที่ 1"): no attachments table — the
// file is a documents row with kind = 'attachment' and the owning row points
// at it through the source_document_id column it already had. Attachments
// skip the AI entirely and never appear in the Docs vault or the AI context.
//
// The same link column is also written by document intake when the AI turns
// a bill into an expense/income/reminder. So a row's source document is one
// of two things, and the UI treats them differently:
//   kind = 'analyzed'   → "open the source document" (the vault owns it)
//   kind = 'attachment' → thumbnail / open / replace / remove (this row owns it)
//
// Upload order is the one fixed in 1.2: insert the row as pending → upload →
// mark ready. A failed upload deletes the row; a tab closed mid-way leaves a
// pending row that the tick removes (with its file, if any) after an hour.

export const ATTACHABLE_TABLES = ["expenses", "incomes", "reminders"] as const;
export type AttachableTable = (typeof ATTACHABLE_TABLES)[number];

export const MAX_ATTACHMENT_MB = 10;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

export type LinkedDoc = {
  id: string;
  kind: string;
  status: string;
  title: string;
  mime_type: string | null;
  storage_path: string | null;
  /** Short-lived URL for an image thumbnail; absent for PDFs and non-images. */
  thumbUrl?: string;
};

export class AttachmentError extends Error {
  constructor(public readonly code: "too_large" | "unsupported_type") {
    super(code);
    this.name = "AttachmentError";
  }
}

function isImage(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("image/");
}

/**
 * The documents rows a page's items point at, keyed by id, with thumbnail
 * URLs for images. One round-trip for the whole list.
 */
export async function loadLinkedDocs(
  ids: Array<string | null | undefined>,
): Promise<Record<string, LinkedDoc>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return {};
  const { data, error } = await supabase
    .from("documents")
    .select("id, kind, status, title, mime_type, storage_path")
    .in("id", wanted);
  if (error) throw error;
  const docs: Record<string, LinkedDoc> = {};
  for (const d of data ?? []) docs[d.id] = d;

  const imagePaths = (data ?? [])
    .filter((d) => isImage(d.mime_type) && d.storage_path)
    .map((d) => d.storage_path!);
  if (imagePaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrls(imagePaths, 300);
    for (const s of signed ?? []) {
      if (!s.signedUrl || !s.path) continue;
      const doc = (data ?? []).find((d) => d.storage_path === s.path);
      if (doc) docs[doc.id]!.thumbUrl = s.signedUrl;
    }
  }
  return docs;
}

/** Opens the file in a new tab through a one-minute signed URL. */
export async function openAttachment(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 60);
  if (error) throw error;
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

/**
 * Attaches `file` to one row. If the row already had an attachment (not an
 * analyzed document), that old file and row are removed once the new link
 * is in place, so a replace never leaves the row without a file.
 */
export async function attachFile(
  table: AttachableTable,
  rowId: string,
  file: File,
  userId: string,
): Promise<LinkedDoc> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentError("too_large");
  const mimeType = file.type || "";
  if (!isImage(mimeType) && mimeType !== "application/pdf")
    throw new AttachmentError("unsupported_type");

  // What the row points at now, to clean up after the switch.
  const { data: current, error: curErr } = await supabase
    .from(table)
    .select("source_document_id")
    .eq("id", rowId)
    .single();
  if (curErr) throw curErr;
  let previous: { id: string; storage_path: string | null } | null = null;
  if (current.source_document_id) {
    const { data: prev } = await supabase
      .from("documents")
      .select("id, kind, storage_path")
      .eq("id", current.source_document_id)
      .maybeSingle();
    if (prev?.kind === "attachment") previous = prev;
  }

  const path = `${userId}/att-${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  const { data: doc, error: insErr } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      title: file.name,
      status: "pending",
      kind: "attachment",
      storage_path: path,
      mime_type: mimeType,
    })
    .select("id")
    .single();
  if (insErr) throw insErr;

  const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
  if (upErr) {
    await supabase.from("documents").delete().eq("id", doc.id);
    throw upErr;
  }

  const { error: readyErr } = await supabase
    .from("documents")
    .update({ status: "ready" })
    .eq("id", doc.id);
  if (readyErr) throw readyErr;
  const { error: linkErr } = await supabase
    .from(table)
    .update({ source_document_id: doc.id })
    .eq("id", rowId);
  if (linkErr) throw linkErr;

  // The old attachment is no longer referenced by anything: file first, then row.
  if (previous) {
    if (previous.storage_path)
      await supabase.storage.from("documents").remove([previous.storage_path]);
    await supabase.from("documents").delete().eq("id", previous.id);
  }

  const [linked] = Object.values(await loadLinkedDocs([doc.id]));
  return linked!;
}

/**
 * Removes an attachment: unlink, then delete the file, then the row. Only
 * for kind = 'attachment' — an analyzed source document belongs to the vault
 * and is left alone (the link is cleared, nothing is deleted).
 */
export async function detachFile(
  table: AttachableTable,
  rowId: string,
  doc: LinkedDoc,
): Promise<void> {
  const { error: unlinkErr } = await supabase
    .from(table)
    .update({ source_document_id: null })
    .eq("id", rowId);
  if (unlinkErr) throw unlinkErr;
  if (doc.kind !== "attachment") return;
  if (doc.storage_path) {
    const { error } = await supabase.storage.from("documents").remove([doc.storage_path]);
    if (error) throw error;
  }
  const { error: delErr } = await supabase.from("documents").delete().eq("id", doc.id);
  if (delErr) throw delErr;
}
