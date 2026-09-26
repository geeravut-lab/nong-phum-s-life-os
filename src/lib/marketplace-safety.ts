import { supabase } from "@/integrations/supabase/client";

/** True if either side blocked the other. */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_blocked_by", {
    p_viewer: a,
    p_other: b,
  });
  if (error) {
    // Fallback direct query if RPC not migrated yet
    const { data: rows } = await supabase
      .from("user_blocks")
      .select("id")
      .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`)
      .limit(1);
    return (rows?.length ?? 0) > 0;
  }
  return data === true;
}

export async function blockUser(blockedId: string, reason?: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");
  if (uid === blockedId) throw new Error("Cannot block yourself");
  const { error } = await supabase.from("user_blocks").insert({
    blocker_id: uid,
    blocked_id: blockedId,
    reason: reason?.slice(0, 200) || null,
  });
  if (error) throw new Error(error.message);
}

export async function unblockUser(blockedId: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", uid)
    .eq("blocked_id", blockedId);
  if (error) throw new Error(error.message);
}

export async function submitSafetyReport(input: {
  targetUserId?: string | null;
  jobId?: string | null;
  reason: string;
  details?: string;
  isEmergency?: boolean;
}) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { error } = await supabase.from("safety_reports").insert({
    reporter_id: uid,
    target_user_id: input.targetUserId ?? null,
    job_id: input.jobId ?? null,
    reason: input.reason.trim().slice(0, 80),
    details: input.details?.trim().slice(0, 2000) || null,
    status: "open",
    is_emergency: input.isEmergency === true,
  });
  if (error) throw new Error(error.message);
}

export async function listMyBlocks() {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];
  const { data } = await supabase
    .from("user_blocks")
    .select("id, blocked_id, reason, created_at")
    .eq("blocker_id", uid)
    .order("created_at", { ascending: false });
  return data ?? [];
}
