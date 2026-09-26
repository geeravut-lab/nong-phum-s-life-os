import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function randomToken(len = 24): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) s += chars[arr[i]! % chars.length];
  return s;
}

function randomPlanCode(): string {
  // 8 chars, easy to dictate (no 0/O/1/I)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 8; i++) s += chars[arr[i]! % chars.length];
  return s;
}

async function ensurePlanCode(userId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("legacy_profiles")
    .select("plan_code")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.plan_code) return existing.plan_code as string;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomPlanCode();
    const { error } = await supabaseAdmin.from("legacy_profiles").upsert({
      user_id: userId,
      plan_code: code,
    });
    if (!error) return code;
  }
  throw new Error("Could not allocate plan code");
}

async function notifyVerifiersLine(subjectUserId: string, caseId: string) {
  try {
    const { lineChannelToken, appOpenUrl } = await import("./line-push.server");
    const token = lineChannelToken();
    if (!token) return;

    const { data: contacts } = await supabaseAdmin
      .from("legacy_contacts")
      .select("linked_user_id, full_name")
      .eq("user_id", subjectUserId)
      .eq("is_verifier", true)
      .eq("invite_status", "accepted");

    const userIds = (contacts ?? [])
      .map((c) => c.linked_user_id as string | null)
      .filter((id): id is string => !!id);

    if (!userIds.length) return;

    const { data: links } = await supabaseAdmin
      .from("line_links")
      .select("user_id, line_user_id")
      .in("user_id", userIds);

    const openUrl = appOpenUrl("/legacy/after");
    const text =
      "Life OS — มีเคสต้องการการยืนยันจากคุณ\n" +
      `กรุณาเปิด: ${openUrl}\n` +
      `(รหัสเคส: ${caseId.slice(0, 8)}…)`;

    for (const link of links ?? []) {
      const to = link.line_user_id as string | null;
      if (!to) continue;
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to,
          messages: [{ type: "text", text }],
        }),
      }).catch(() => {});
    }
  } catch {
    // non-fatal
  }
}

/** Owner: ensure public plan code exists (for relatives to open a case without UUID). */
export const ensureMyPlanCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const code = await ensurePlanCode(context.userId);
    const origin =
      process.env["APP_PUBLIC_URL"] || process.env["URL"] || "https://lavieos.netlify.app";
    return {
      planCode: code,
      inviteBaseUrl: `${origin.replace(/\/$/, "")}/legacy/invite`,
    };
  });

/** Owner: create/refresh invite link for a contact marked as verifier. */
export const createVerifierInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ contactId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("legacy_contacts")
      .select("id, user_id, is_verifier, full_name")
      .eq("id", data.contactId)
      .single();
    if (error || !row) throw new Error(error?.message ?? "contact not found");
    if (row.user_id !== context.userId) throw new Error("Forbidden");
    if (!row.is_verifier) throw new Error("Contact is not marked as verifier");

    const token = randomToken(28);
    const { error: upErr } = await context.supabase
      .from("legacy_contacts")
      .update({
        invite_token: token,
        invite_status: "pending",
        linked_user_id: null,
      })
      .eq("id", data.contactId);
    if (upErr) throw new Error(upErr.message);

    const origin =
      process.env["APP_PUBLIC_URL"] || process.env["URL"] || "https://lavieos.netlify.app";
    const url = `${origin.replace(/\/$/, "")}/legacy/invite/${token}`;
    return { token, url, contactName: row.full_name };
  });

/** Invitee: accept invite after login → bind linked_user_id. */
export const acceptVerifierInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await supabaseAdmin
      .from("legacy_contacts")
      .select("id, user_id, full_name, is_verifier, invite_status, invite_token")
      .eq("invite_token", data.token)
      .maybeSingle();
    if (error || !row) throw new Error("Invite not found or expired");
    if (!row.is_verifier) throw new Error("Not a verifier invite");
    if (row.invite_status === "revoked") throw new Error("Invite was revoked");
    if (row.user_id === context.userId) {
      throw new Error("You cannot accept your own verifier invite");
    }

    const { error: upErr } = await supabaseAdmin
      .from("legacy_contacts")
      .update({
        linked_user_id: context.userId,
        invite_status: "accepted",
      })
      .eq("id", row.id);
    if (upErr) throw new Error(upErr.message);

    // Peek subject plan code for the invitee
    const { data: prof } = await supabaseAdmin
      .from("legacy_profiles")
      .select("plan_code, display_label")
      .eq("user_id", row.user_id)
      .maybeSingle();

    return {
      ok: true as const,
      contactName: row.full_name,
      subjectUserId: row.user_id as string,
      planCode: (prof?.plan_code as string | null) ?? null,
      displayLabel: (prof?.display_label as string | null) ?? "",
    };
  });

/** Preview invite (authenticated) — for the accept page. */
export const previewVerifierInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("legacy_contacts")
      .select("full_name, is_verifier, invite_status, user_id")
      .eq("invite_token", data.token)
      .maybeSingle();
    if (!row) return { found: false as const };
    const { data: prof } = await supabaseAdmin
      .from("legacy_profiles")
      .select("display_label, plan_code")
      .eq("user_id", row.user_id)
      .maybeSingle();
    return {
      found: true as const,
      contactName: row.full_name as string,
      inviteStatus: row.invite_status as string,
      isVerifier: row.is_verifier as boolean,
      displayLabel: (prof?.display_label as string | null) ?? "",
      planCode: (prof?.plan_code as string | null) ?? null,
    };
  });

/** Open death case by public plan code (no UUID). */
export const reportDeathByPlanCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        planCode: z.string().min(4).max(16),
        note: z.string().max(2000).default(""),
        requiredConfirmations: z.number().int().min(2).max(5).default(2),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const code = data.planCode.trim().toUpperCase();
    const { data: prof, error: pErr } = await supabaseAdmin
      .from("legacy_profiles")
      .select("user_id, plan_code, display_label")
      .eq("plan_code", code)
      .maybeSingle();
    if (pErr || !prof) throw new Error("Plan code not found");

    const subjectUserId = prof.user_id as string;
    if (subjectUserId === context.userId) {
      throw new Error("You cannot open a case for yourself");
    }

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    // Must be linked verifier OR admin
    if (!isAdmin) {
      const { data: link } = await supabaseAdmin
        .from("legacy_contacts")
        .select("id")
        .eq("user_id", subjectUserId)
        .eq("linked_user_id", context.userId)
        .eq("is_verifier", true)
        .eq("invite_status", "accepted")
        .maybeSingle();
      if (!link) {
        throw new Error("Not authorized: accept a verifier invite for this plan first");
      }
    }

    const { data: existing } = await supabaseAdmin
      .from("death_cases")
      .select("id, status")
      .eq("subject_user_id", subjectUserId)
      .maybeSingle();
    if (existing) {
      return {
        caseId: existing.id as string,
        status: existing.status as string,
        alreadyExists: true as const,
        subjectUserId,
        displayLabel: (prof.display_label as string) || code,
      };
    }

    const { data: row, error } = await supabaseAdmin
      .from("death_cases")
      .insert({
        subject_user_id: subjectUserId,
        reported_by: context.userId,
        report_note: data.note,
        required_confirmations: data.requiredConfirmations,
        status: "pending",
      })
      .select("id, status")
      .single();
    if (error) throw new Error(error.message);

    void notifyVerifiersLine(subjectUserId, row.id as string);

    return {
      caseId: row.id as string,
      status: row.status as string,
      alreadyExists: false as const,
      subjectUserId,
      displayLabel: (prof.display_label as string) || code,
    };
  });

/** Report by UUID (admin / advanced). Kept for compatibility. */
export const reportDeathCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        subjectUserId: z.string().uuid(),
        note: z.string().max(2000).default(""),
        requiredConfirmations: z.number().int().min(2).max(5).default(2),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: uid,
      _role: "admin",
    });
    if (!isAdmin) {
      const { data: link } = await supabaseAdmin
        .from("legacy_contacts")
        .select("id")
        .eq("user_id", data.subjectUserId)
        .eq("linked_user_id", uid)
        .eq("is_verifier", true)
        .eq("invite_status", "accepted")
        .maybeSingle();
      if (!link) {
        throw new Error("Not authorized: linked verifier only (or use plan code)");
      }
    }

    const { data: existing } = await supabaseAdmin
      .from("death_cases")
      .select("id, status")
      .eq("subject_user_id", data.subjectUserId)
      .maybeSingle();
    if (existing) {
      return {
        caseId: existing.id as string,
        status: existing.status as string,
        alreadyExists: true as const,
      };
    }

    const { data: row, error } = await supabaseAdmin
      .from("death_cases")
      .insert({
        subject_user_id: data.subjectUserId,
        reported_by: uid,
        report_note: data.note,
        required_confirmations: data.requiredConfirmations,
        status: "pending",
      })
      .select("id, status")
      .single();
    if (error) throw new Error(error.message);

    void notifyVerifiersLine(data.subjectUserId, row.id as string);

    return {
      caseId: row.id as string,
      status: row.status as string,
      alreadyExists: false as const,
    };
  });

export const confirmDeathCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        decision: z.enum(["confirm", "reject"]),
        confirmerName: z.string().min(1).max(120),
        note: z.string().max(1000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: c, error } = await supabaseAdmin
      .from("death_cases")
      .select(
        "id, status, subject_user_id, required_confirmations, confirmation_count, reported_by",
      )
      .eq("id", data.caseId)
      .single();
    if (error || !c) throw new Error(error?.message ?? "case not found");
    if (c.status === "cancelled" || c.status === "rejected") {
      throw new Error("Case is closed");
    }

    // Must be linked verifier, reporter, or admin
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) {
      const { data: link } = await supabaseAdmin
        .from("legacy_contacts")
        .select("id")
        .eq("user_id", c.subject_user_id)
        .eq("linked_user_id", context.userId)
        .eq("is_verifier", true)
        .eq("invite_status", "accepted")
        .maybeSingle();
      if (!link && c.reported_by !== context.userId) {
        throw new Error("Not authorized to confirm this case");
      }
    }

    const { error: insErr } = await supabaseAdmin.from("death_confirmations").insert({
      case_id: data.caseId,
      confirmer_user_id: context.userId,
      confirmer_name: data.confirmerName,
      decision: data.decision,
      note: data.note,
    });
    if (insErr) throw new Error(insErr.message);

    const { data: updated } = await supabaseAdmin
      .from("death_cases")
      .select("id, status, confirmation_count, required_confirmations, confirmed_at")
      .eq("id", data.caseId)
      .single();
    return updated;
  });

/** Cases where current user is a linked verifier (or reporter). */
export const listMyVerifierCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: links } = await supabaseAdmin
      .from("legacy_contacts")
      .select("user_id, full_name")
      .eq("linked_user_id", context.userId)
      .eq("is_verifier", true)
      .eq("invite_status", "accepted");

    const subjectIds = (links ?? []).map((l) => l.user_id as string);
    if (!subjectIds.length) return { cases: [] as const, duties: links ?? [] };

    const { data: cases } = await supabaseAdmin
      .from("death_cases")
      .select(
        "id, subject_user_id, status, confirmation_count, required_confirmations, report_note, created_at",
      )
      .in("subject_user_id", subjectIds)
      .order("created_at", { ascending: false });

    const { data: profiles } = await supabaseAdmin
      .from("legacy_profiles")
      .select("user_id, plan_code, display_label")
      .in("user_id", subjectIds);

    const labelByUser = new Map(
      (profiles ?? []).map((p) => [
        p.user_id as string,
        (p.display_label as string) || (p.plan_code as string) || "",
      ]),
    );

    return {
      duties: links ?? [],
      cases: (cases ?? []).map((c) => ({
        ...c,
        label: labelByUser.get(c.subject_user_id as string) ?? "",
      })),
    };
  });

/** List post-life actions for a confirmed case (or seed if missing). */
export const listPostLifeActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const admin = supabaseAdmin;
    const { data: c, error } = await admin
      .from("death_cases")
      .select("id, status, subject_user_id")
      .eq("id", data.caseId)
      .single();
    if (error || !c) throw new Error(error?.message ?? "case not found");
    if (c.status !== "confirmed") {
      return { actions: [] as const, caseStatus: c.status as string };
    }

    // Seed if empty (covers cases confirmed before migration / trigger miss)
    const { data: existing } = await admin
      .from("post_life_actions")
      .select("id")
      .eq("case_id", data.caseId)
      .limit(1);
    if (!existing?.length) {
      const subject = c.subject_user_id as string;
      const templates: Array<{
        phase: string;
        sort_order: number;
        title: string;
        description: string;
      }> = [
        {
          phase: "24h",
          sort_order: 1,
          title: "แจ้งบุคคลที่กำหนด",
          description: "ติดต่อคนที่ไว้ใจตามลำดับความสำคัญในแผนฝากไว้",
        },
        {
          phase: "24h",
          sort_order: 2,
          title: "เปิด Memorial",
          description: "ตรวจสอบ/แชร์หน้าอาลัยบุ๊คให้ครอบครัว",
        },
        {
          phase: "24h",
          sort_order: 3,
          title: "แจ้งข้อมูลที่ได้รับอนุญาต",
          description: "ส่งเฉพาะข้อมูลที่เจ้าของแผนอนุญาต",
        },
        {
          phase: "3d",
          sort_order: 1,
          title: "เอกสารสำคัญ",
          description: "รวบรวมบัตรประชาชน สำเนา และเอกสารที่อ้างในแผน",
        },
        {
          phase: "3d",
          sort_order: 2,
          title: "สถานที่และพิธี",
          description: "ยืนยันสถานที่จัดพิธีตามความต้องการงานศพ",
        },
        {
          phase: "3d",
          sort_order: 3,
          title: "ผู้ให้บริการ",
          description: "ติดต่อวัด/สถานที่/ผู้ให้บริการที่เกี่ยวข้อง",
        },
        {
          phase: "3d",
          sort_order: 4,
          title: "แผนงานศพ (ถ้ามี)",
          description: "ดูแพ็กเกจจาก AI Funeral Planner และสถานะการชำระ",
        },
        {
          phase: "later",
          sort_order: 1,
          title: "ทรัพย์สิน",
          description: "เปิดดูรายการทรัพย์สินในแผนฝากไว้ (ไม่ใช่เอกสารทางกฎหมาย)",
        },
        {
          phase: "later",
          sort_order: 2,
          title: "หนี้สิน / ภาระ",
          description: "ตรวจสอบรายการหนี้และภาระที่บันทึกไว้",
        },
        {
          phase: "later",
          sort_order: 3,
          title: "ประกันและสิทธิ",
          description: "ติดต่อบริษัทประกัน / สิทธิที่เกี่ยวข้อง",
        },
        {
          phase: "later",
          sort_order: 4,
          title: "บัญชีและดิจิทัล",
          description: "จัดการบัญชีตามที่ระบุในแผน",
        },
        {
          phase: "later",
          sort_order: 5,
          title: "มรดก / พินัยกรรม (อ้างอิง)",
          description: "ติดตามที่เก็บพินัยกรรม — ดำเนินการตามกฎหมายภายนอกแอป",
        },
      ];
      await admin.from("post_life_actions").insert(
        templates.map((x) => ({
          case_id: data.caseId,
          subject_user_id: subject,
          ...x,
        })),
      );
    }

    const { data: rows, error: aErr } = await admin
      .from("post_life_actions")
      .select("id, case_id, phase, sort_order, title, description, status, done_at, note")
      .eq("case_id", data.caseId)
      .order("sort_order", { ascending: true });
    if (aErr) throw new Error(aErr.message);
    const phaseOrder = { "24h": 0, "3d": 1, later: 2 } as Record<string, number>;
    const sorted = [...(rows ?? [])].sort(
      (a, b) =>
        (phaseOrder[a.phase as string] ?? 9) - (phaseOrder[b.phase as string] ?? 9) ||
        (a.sort_order as number) - (b.sort_order as number),
    );
    return { actions: sorted, caseStatus: "confirmed" as const };
  });

/** Mark a post-life action done / open / skipped. */
export const updatePostLifeAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        actionId: z.string().uuid(),
        status: z.enum(["open", "done", "skipped"]),
        note: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const patch =
      data.status === "done"
        ? {
            status: data.status,
            updated_at: now,
            done_at: now,
            done_by: context.userId,
            ...(data.note !== undefined ? { note: data.note } : {}),
          }
        : {
            status: data.status,
            updated_at: now,
            done_at: null as string | null,
            done_by: null as string | null,
            ...(data.note !== undefined ? { note: data.note } : {}),
          };

    const { data: row, error } = await supabaseAdmin
      .from("post_life_actions")
      .update(patch)
      .eq("id", data.actionId)
      .select("id, status, done_at, note")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
