import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * PDPA data export.
 *
 * Security & Trust in the blueprint asks for "data export AND deletion". The
 * deletion half already exists (account.server.ts); this is the other half, so
 * a user can get a copy of what the system holds about them before deciding to
 * delete it.
 *
 * Shape: one JSON object, table name -> rows, plus a manifest. Storage objects
 * are listed by path and signed url rather than embedded, so the export stays
 * a document rather than a multi-hundred-megabyte payload.
 */

/**
 * Every table holding rows about one user, with the column that owns them.
 * Checked against the generated types rather than guessed - the owner column
 * is not always user_id (job_offers keys on the helper, the death and memorial
 * tables on the subject).
 */
const OWNED_TABLES = [
  { table: "profiles", col: "id" },
  { table: "documents", col: "user_id" },
  { table: "reminders", col: "user_id" },
  { table: "expenses", col: "user_id" },
  { table: "incomes", col: "user_id" },
  { table: "chat_messages", col: "user_id" },
  { table: "user_roles", col: "user_id" },
  { table: "benefit_profiles", col: "user_id" },
  { table: "user_benefits", col: "user_id" },
  { table: "decisions", col: "user_id" },
  { table: "legacy_assets", col: "user_id" },
  { table: "legacy_contacts", col: "user_id" },
  { table: "legacy_wishes", col: "user_id" },
  { table: "legacy_profiles", col: "user_id" },
  { table: "legacy_checklist", col: "user_id" },
  { table: "funeral_plans", col: "user_id" },
  { table: "death_cases", col: "subject_user_id" },
  { table: "post_life_actions", col: "subject_user_id" },
  { table: "memorials", col: "subject_user_id" },
  { table: "premium_payments", col: "user_id" },
  { table: "user_subscriptions", col: "user_id" },
  { table: "donations", col: "user_id" },
  { table: "ai_usage_monthly", col: "user_id" },
  { table: "helper_profiles", col: "user_id" },
  { table: "jobs", col: "user_id" },
  { table: "job_offers", col: "helper_user_id" },
  { table: "family_checkins", col: "user_id" },
  { table: "privacy_audit_log", col: "user_id" },
  { table: "line_links", col: "user_id" },
  { table: "aivora_links", col: "user_id" },
] as const;

export type ExportManifest = {
  generatedAt: string;
  userId: string;
  email: string | null;
  tables: Record<string, number>;
  files: number;
  skipped: Record<string, string>;
};

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    const data: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    // A table that does not exist in this deployment, or that the export is
    // not entitled to read, is recorded rather than failing the whole export.
    const skipped: Record<string, string> = {};

    for (const { table, col } of OWNED_TABLES) {
      // The column name is a literal per table, but eq() wants the column type
      // of the table it was called on; the pair is verified in the list above.
      const { data: rows, error } = await supabaseAdmin
        .from(table)
        .select("*")
        .eq(col as never, uid);
      if (error) {
        skipped[table] = error.message;
        continue;
      }
      data[table] = rows ?? [];
      counts[table] = (rows ?? []).length;
    }

    // Family rows are shared by nature: export the membership and the events
    // the user created, not the whole family's data.
    const { data: memberships } = await supabaseAdmin
      .from("family_members")
      .select("*")
      .eq("user_id", uid);
    data["family_members"] = memberships ?? [];
    counts["family_members"] = (memberships ?? []).length;

    const { data: myEvents } = await supabaseAdmin
      .from("family_events")
      .select("*")
      .eq("created_by", uid);
    data["family_events_created_by_me"] = myEvents ?? [];
    counts["family_events_created_by_me"] = (myEvents ?? []).length;

    // Attached files: path + a short-lived signed url each, so the user can
    // download them without the export carrying the bytes.
    const files: Array<{ path: string; title: string | null; url: string | null }> = [];
    const docRows = (data["documents"] ?? []) as Array<{
      storage_path?: string | null;
      title?: string | null;
    }>;
    for (const d of docRows) {
      if (!d.storage_path) continue;
      const { data: signed } = await supabaseAdmin.storage
        .from("documents")
        .createSignedUrl(d.storage_path, 60 * 60);
      files.push({
        path: d.storage_path,
        title: d.title ?? null,
        url: signed?.signedUrl ?? null,
      });
    }

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(uid);

    const manifest: ExportManifest = {
      generatedAt: new Date().toISOString(),
      userId: uid,
      email: authUser.user?.email ?? null,
      tables: counts,
      files: files.length,
      skipped,
    };

    // Same audit trail the rest of the privacy surface writes to, so an export
    // is as traceable as a deletion.
    await supabaseAdmin.from("privacy_audit_log").insert({
      user_id: uid,
      action: "data_export",
      detail: `exported ${Object.values(counts).reduce((a, b) => a + b, 0)} rows, ${files.length} files`,
      meta: { tables: Object.keys(counts).length, files: files.length },
    });

    // Serialized here rather than returned as a nested object: the payload is
    // arbitrary row shapes, which the server-function boundary cannot type as
    // serializable, and the client only needs the text to write into a file.
    return {
      filename: `life-os-export-${manifest.generatedAt.slice(0, 10)}.json`,
      json: JSON.stringify({ manifest, data, files }, null, 2),
      manifest,
    };
  });
