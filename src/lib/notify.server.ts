import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Writing app_notifications rows.
 *
 * The nav badge is driven entirely by unread rows in this table: useInboxBadges
 * subscribes to inserts in realtime, kindToNav maps a row to a menu item by its
 * href, and AppShell hides the dot for the page the user is already on and
 * marks rows read when they arrive there. So "notify the user" always means
 * "insert a row here with the right href" - there is nothing else to do.
 *
 * Every action that changes something for *another* person should call one of
 * these. Notifying the actor about their own action is noise, so each helper
 * takes the actor and skips them.
 */

export type Notice = {
  kind: string;
  title: string;
  body: string;
  /** Menu path the dot should appear on, e.g. "/helpme" or "/support". */
  href: string;
  refTable?: string | null;
  refId?: string | null;
};

/** Notify specific users, skipping the actor and any duplicates. */
export async function notifyUsers(
  userIds: Array<string | null | undefined>,
  n: Notice,
  actorUserId?: string | null,
): Promise<number> {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))].filter(
    (u) => u !== actorUserId,
  );
  if (ids.length === 0) return 0;

  const { error } = await supabaseAdmin.from("app_notifications").insert(
    ids.map((uid) => ({
      user_id: uid,
      kind: n.kind,
      title: n.title,
      body: n.body,
      href: n.href,
      ref_table: n.refTable ?? null,
      ref_id: n.refId ?? null,
    })),
  );
  // A failed notification must never fail the action that triggered it: the
  // payment still went through, the message was still sent.
  if (error) {
    console.error("[notify] insert failed:", error.message);
    return 0;
  }
  return ids.length;
}

/** Notify every admin - used for things a human has to action, like a slip to check. */
export async function notifyAdmins(n: Notice, actorUserId?: string | null): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  if (error) {
    console.error("[notify] admin lookup failed:", error.message);
    return 0;
  }
  return notifyUsers(
    (data ?? []).map((r) => r.user_id as string),
    n,
    actorUserId,
  );
}

/** Both sides of a job, minus whoever acted. */
export async function notifyJobParties(
  jobId: string,
  n: Notice,
  actorUserId?: string | null,
): Promise<number> {
  const { data: job } = await supabaseAdmin
    .from("jobs")
    .select("user_id, assigned_helper_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return 0;

  // assigned_helper_id points at a helper_profiles row, not a user.
  let helperUserId: string | null = null;
  if (job.assigned_helper_id) {
    const { data: helper } = await supabaseAdmin
      .from("helper_profiles")
      .select("user_id")
      .eq("id", job.assigned_helper_id as string)
      .maybeSingle();
    helperUserId = (helper?.user_id as string | null) ?? null;
  }

  return notifyUsers([job.user_id as string, helperUserId], n, actorUserId);
}
