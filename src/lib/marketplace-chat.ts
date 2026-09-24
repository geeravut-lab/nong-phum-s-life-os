import { supabase } from "@/integrations/supabase/client";

const MAX_EVIDENCE_MB = 10;
const MAX_EVIDENCE_BYTES = MAX_EVIDENCE_MB * 1024 * 1024;

export type JobMessage = {
  id: string;
  job_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type JobEvidence = {
  id: string;
  job_id: string;
  uploader_id: string;
  title: string;
  mime_type: string | null;
  storage_path: string;
  note: string | null;
  created_at: string;
  url?: string;
};

export async function listJobMessages(jobId: string): Promise<JobMessage[]> {
  const { data, error } = await supabase
    .from("job_messages")
    .select("id, job_id, sender_id, body, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as JobMessage[];
}

export async function sendJobMessage(jobId: string, body: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");
  const text = body.trim();
  if (!text) throw new Error("Empty message");
  const { error } = await supabase.from("job_messages").insert({
    job_id: jobId,
    sender_id: uid,
    body: text.slice(0, 4000),
  });
  if (error) throw new Error(error.message);
}

export async function listJobEvidence(jobId: string): Promise<JobEvidence[]> {
  const { data, error } = await supabase
    .from("job_evidence")
    .select("id, job_id, uploader_id, title, mime_type, storage_path, note, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as JobEvidence[];
  const withUrls = await Promise.all(
    rows.map(async (r) => {
      if (!r.storage_path) return r;
      const { data: signed } = await supabase.storage
        .from("documents")
        .createSignedUrl(r.storage_path, 3600);
      return { ...r, url: signed?.signedUrl };
    }),
  );
  return withUrls;
}

export async function uploadJobEvidence(jobId: string, file: File, note?: string) {
  if (file.size > MAX_EVIDENCE_BYTES) {
    throw new Error(`File too large (max ${MAX_EVIDENCE_MB}MB)`);
  }
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");

  const ext = file.name.split(".").pop()?.slice(0, 8) || "bin";
  const path = `job-evidence/${jobId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage.from("documents").upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);

  const { error } = await supabase.from("job_evidence").insert({
    job_id: jobId,
    uploader_id: uid,
    title: file.name.slice(0, 120),
    mime_type: file.type || null,
    storage_path: path,
    note: note?.trim().slice(0, 500) || null,
  });
  if (error) {
    await supabase.storage.from("documents").remove([path]);
    throw new Error(error.message);
  }
}

export async function deleteJobEvidence(id: string, storagePath: string) {
  const { error } = await supabase.from("job_evidence").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await supabase.storage.from("documents").remove([storagePath]);
}
