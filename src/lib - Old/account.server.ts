import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Self-service account deletion. The database cascade (phase 1.2 migration)
// removes every row the user owns once auth.users loses the row; this module
// does the three things the cascade cannot:
//   1. tell the user beforehand exactly what will go, including the families
//      they own and who else is in them
//   2. clear the sharing flags on OTHER members' rows before their family is
//      dissolved — the cascade nulls family_id but leaves is_shared = true,
//      which would misdescribe those rows forever
//   3. remove the user's files from storage, which Postgres knows nothing about
// and it writes one audit row before the user disappears.

type Db = SupabaseClient<any, "public", any>;

// Tables with a user_id column that will be cascaded. profiles/user_roles are
// implied and not interesting to the user; families is handled separately.
const OWNED_TABLES = [
  "documents",
  "reminders",
  "expenses",
  "incomes",
  "chat_messages",
  "helper_profiles",
  "jobs",
  "benefit_profiles",
  "user_benefits",
] as const;

export type OwnedFamily = { id: string; name: string; otherMembers: number };

export type DeletionPreview = {
  counts: Record<(typeof OWNED_TABLES)[number], number>;
  storageFiles: number;
  /** Families this user owns; deleting the account dissolves each one. */
  ownedFamilies: OwnedFamily[];
  /** Families this user is a plain member of; they simply leave. */
  memberOfFamilies: number;
  isSsoUser: boolean;
  isLineLinked: boolean;
  donations: number;
};

/** Everything the confirmation dialog needs, read with the caller's own client (RLS-scoped). */
export async function deletionPreview(db: Db, userId: string): Promise<DeletionPreview> {
  const counts = {} as DeletionPreview["counts"];
  await Promise.all(
    OWNED_TABLES.map(async (table) => {
      const { count } = await db
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      counts[table] = count ?? 0;
    }),
  );

  const { data: owned } = await db.from("families").select("id, name").eq("owner_id", userId);
  const ownedFamilies: OwnedFamily[] = [];
  for (const f of owned ?? []) {
    // family_members_read lets a member see every row of their family.
    const { count } = await db
      .from("family_members")
      .select("id", { count: "exact", head: true })
      .eq("family_id", f.id)
      .neq("user_id", userId);
    ownedFamilies.push({ id: f.id, name: f.name, otherMembers: count ?? 0 });
  }

  const { count: memberships } = await db
    .from("family_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  const memberOfFamilies = Math.max(0, (memberships ?? 0) - ownedFamilies.length);

  const storageFiles = (await listUserFiles(userId)).length;

  const { data: link } = await supabaseAdmin
    .from("aivora_links")
    .select("aivora_user_id")
    .eq("user_id", userId)
    .maybeSingle();
  const { data: line } = await supabaseAdmin
    .from("line_links")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  const { count: donations } = await supabaseAdmin
    .from("donations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return {
    counts,
    storageFiles,
    ownedFamilies,
    memberOfFamilies,
    isSsoUser: !!link,
    isLineLinked: !!line,
    donations: donations ?? 0,
  };
}

async function listUserFiles(userId: string): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin.storage
      .from("documents")
      .list(userId, { limit: 1000, offset });
    if (error) throw error;
    if (!data?.length) break;
    for (const f of data) out.push(`${userId}/${f.name}`);
    if (data.length < 1000) break;
    offset += data.length;
  }
  return out;
}

/**
 * Deletes the account. Order matters:
 *   a. un-share other members' rows in families this user owns (service role:
 *      they are not this user's rows) — before the cascade drops the family
 *   b. remove the user's storage files (Postgres cannot)
 *   c. write the audit row
 *   d. auth.admin.deleteUser — the cascade takes every owned row from here
 * If (a) or (b) fails the account is left intact; the caller can retry.
 */
export async function deleteAccount(
  db: Db,
  userId: string,
): Promise<{ removedFiles: number; dissolvedFamilies: number }> {
  const preview = await deletionPreview(db, userId);
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  // a. Families this user owns are about to be dissolved by the cascade.
  //    The cascade sets family_id = NULL on members' shared rows but leaves
  //    is_shared = true; clear both so the rows describe themselves honestly.
  for (const fam of preview.ownedFamilies) {
    for (const table of ["documents", "reminders", "expenses", "incomes"] as const) {
      const { error } = await supabaseAdmin
        .from(table)
        .update({ is_shared: false, family_id: null })
        .eq("family_id", fam.id);
      if (error)
        throw new Error(`could not un-share ${table} in family ${fam.id}: ${error.message}`);
    }
  }

  // b. Storage. Done before the auth row goes so a failure here leaves a
  //    working account rather than a deleted user with stranded files.
  const files = await listUserFiles(userId);
  if (files.length > 0) {
    const { error } = await supabaseAdmin.storage.from("documents").remove(files);
    if (error)
      throw new Error(`could not remove ${files.length} storage file(s): ${error.message}`);
  }

  // b2. Donations are an income ledger with no FK to the user: the rows stay
  //     (the money did arrive) but nothing personal remains on them.
  {
    const { error } = await supabaseAdmin
      .from("donations")
      .update({ display_name: "ผู้ใช้ที่ลบบัญชีแล้ว", email: null, anonymous: true })
      .eq("user_id", userId);
    if (error) throw new Error(`could not anonymise donations: ${error.message}`);
  }

  // c. Audit row — the only trace that survives.
  const { data: link } = await supabaseAdmin
    .from("aivora_links")
    .select("aivora_user_id")
    .eq("user_id", userId)
    .maybeSingle();
  const { error: auditErr } = await supabaseAdmin.from("account_deletions").insert({
    user_id: userId,
    email: authUser.user?.email ?? null,
    display_name: profile?.display_name ?? null,
    aivora_user_id: link?.aivora_user_id ?? null,
    removed: {
      ...preview.counts,
      storage_files: files.length,
      families_dissolved: preview.ownedFamilies.map((f) => ({
        id: f.id,
        name: f.name,
        other_members: f.otherMembers,
      })),
      families_left: preview.memberOfFamilies,
    },
    requested_by: "self",
  });
  if (auditErr) throw new Error(`could not write audit row: ${auditErr.message}`);

  // d. The cascade does the rest.
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`deleteUser: ${error.message}`);

  console.info(
    `[account] deleted user=${userId} files=${files.length} families_dissolved=${preview.ownedFamilies.length}`,
  );
  return { removedFiles: files.length, dissolvedFamilies: preview.ownedFamilies.length };
}
