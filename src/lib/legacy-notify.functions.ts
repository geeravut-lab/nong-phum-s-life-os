import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function appOrigin(): string {
  return (
    process.env["APP_PUBLIC_URL"] ||
    process.env["URL"] ||
    "https://lavieos.netlify.app"
  ).replace(/\/$/, "");
}

async function assertCaseAccess(userId: string, caseId: string) {
  const { data: c, error } = await supabaseAdmin
    .from("death_cases")
    .select("id, status, subject_user_id, reported_by")
    .eq("id", caseId)
    .single();
  if (error || !c) throw new Error(error?.message ?? "case not found");

  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (isAdmin) return c;
  if (c.reported_by === userId || c.subject_user_id === userId) return c;

  const { data: link } = await supabaseAdmin
    .from("legacy_contacts")
    .select("id")
    .eq("user_id", c.subject_user_id)
    .eq("linked_user_id", userId)
    .eq("is_verifier", true)
    .eq("invite_status", "accepted")
    .maybeSingle();
  if (!link) throw new Error("Forbidden");
  return c;
}

/** Build personalized notify messages for trusted contacts + memorial/schedule links. */
export const generateDeathNotifyMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const c = await assertCaseAccess(context.userId, data.caseId);
    const subjectId = c.subject_user_id as string;

    const { data: contacts } = await supabaseAdmin
      .from("legacy_contacts")
      .select("id, full_name, relation, phone, email, priority, personal_message")
      .eq("user_id", subjectId)
      .order("priority", { ascending: true });

    const { data: memorial } = await supabaseAdmin
      .from("memorials")
      .select("id, share_token, is_public, title, schedule_text, video_url")
      .eq("death_case_id", data.caseId)
      .maybeSingle();

    // Fallback: any memorial for subject
    let mem = memorial;
    if (!mem) {
      const { data: m2 } = await supabaseAdmin
        .from("memorials")
        .select("id, share_token, is_public, title, schedule_text, video_url")
        .eq("subject_user_id", subjectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      mem = m2;
    }

    const memorialUrl =
      mem?.share_token && mem.is_public ? `${appOrigin()}/memorial/${mem.share_token}` : null;

    // Funeral schedule from plan
    const { data: plan } = await supabaseAdmin
      .from("funeral_plans")
      .select("id, packages, selected_package, total_budget, status, input")
      .eq("death_case_id", data.caseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let scheduleBlock = (mem?.schedule_text as string) || "";
    if (!scheduleBlock && plan) {
      const pkgs =
        (plan.packages as Array<{
          id: string;
          name: string;
          summary?: string;
          timeline?: string[];
        }>) ?? [];
      const selected = pkgs.find((p) => p.id === plan.selected_package) ?? pkgs[0];
      if (selected) {
        const lines = [
          `แพ็กเกจ: ${selected.name}`,
          selected.summary ? selected.summary : "",
          ...(selected.timeline ?? []).slice(0, 5),
        ].filter(Boolean);
        scheduleBlock = lines.join("\n");
        // Persist on memorial for public page
        if (mem?.id && scheduleBlock) {
          await supabaseAdmin
            .from("memorials")
            .update({ schedule_text: scheduleBlock })
            .eq("id", mem.id);
        }
      }
    }

    const { data: profile } = await supabaseAdmin
      .from("legacy_profiles")
      .select("display_label, plan_code")
      .eq("user_id", subjectId)
      .maybeSingle();
    const subjectLabel =
      (profile?.display_label as string)?.trim() ||
      (profile?.plan_code as string) ||
      "บุคคลอันเป็นที่รัก";

    // Clear previous generated set for this case (regenerate)
    await supabaseAdmin.from("death_notify_messages").delete().eq("case_id", data.caseId);

    const rows: Array<{
      case_id: string;
      contact_id: string | null;
      contact_name: string;
      channel_hint: string;
      message_body: string;
      memorial_url: string | null;
      created_by: string;
    }> = [];

    const list = contacts?.length
      ? contacts
      : [
          {
            id: null as string | null,
            full_name: "ครอบครัวและผู้เกี่ยวข้อง",
            relation: "",
            phone: null as string | null,
            email: null as string | null,
            priority: 1,
            personal_message: "",
          },
        ];

    for (const contact of list) {
      const name = (contact.full_name as string) || "ท่าน";
      const channel = [contact.phone, contact.email].filter(Boolean).join(" · ");
      const personal = (contact.personal_message as string)?.trim();
      const parts = [
        `เรียน ${name}${contact.relation ? ` (${contact.relation})` : ""}`,
        "",
        `ขอแจ้งว่า ${subjectLabel} ได้จากไปแล้ว และครอบครัวกำลังดำเนินการตามแผนที่ท่านวางไว้`,
        personal ? `\nข้อความที่ฝากถึงคุณ:\n「${personal}」` : "",
        memorialUrl ? `\nหน้าอาลัยบุ๊ค (Memorial):\n${memorialUrl}` : "",
        scheduleBlock ? `\nกำหนดการ / แผนพิธี (สรุป):\n${scheduleBlock}` : "",
        "",
        "ข้อความนี้สร้างจาก Life OS เพื่อช่วยประสานงาน — ไม่ใช่เอกสารทางกฎหมาย",
      ];
      const message_body = parts
        .filter((p) => p !== undefined)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");

      rows.push({
        case_id: data.caseId,
        contact_id: (contact.id as string | null) ?? null,
        contact_name: name,
        channel_hint: channel,
        message_body,
        memorial_url: memorialUrl,
        created_by: context.userId,
      });
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("death_notify_messages")
      .insert(rows)
      .select("id, contact_name, channel_hint, message_body, memorial_url, created_at");
    if (error) throw new Error(error.message);

    return {
      messages: inserted ?? [],
      memorialUrl,
      scheduleText: scheduleBlock,
      videoUrl: (mem?.video_url as string | null) ?? null,
    };
  });

export const listDeathNotifyMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCaseAccess(context.userId, data.caseId);
    const { data: rows, error } = await supabaseAdmin
      .from("death_notify_messages")
      .select("id, contact_name, channel_hint, message_body, memorial_url, created_at")
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { messages: rows ?? [] };
  });

/** Update memorial video / schedule (verifier or admin). */
export const updateMemorialExtras = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        memorialId: z.string().uuid(),
        videoUrl: z.string().url().max(500).optional().or(z.literal("")),
        scheduleText: z.string().max(4000).optional(),
        isPublic: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: m, error } = await supabaseAdmin
      .from("memorials")
      .select("id, death_case_id, subject_user_id, created_by")
      .eq("id", data.memorialId)
      .single();
    if (error || !m) throw new Error(error?.message ?? "not found");

    if (m.death_case_id) {
      await assertCaseAccess(context.userId, m.death_case_id as string);
    } else {
      const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin && m.created_by !== context.userId) throw new Error("Forbidden");
    }

    let shareToken: string | undefined;
    if (data.isPublic) {
      const { data: cur } = await supabaseAdmin
        .from("memorials")
        .select("share_token")
        .eq("id", data.memorialId)
        .single();
      if (!cur?.share_token) {
        shareToken = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      }
    }

    const { data: row, error: upErr } = await supabaseAdmin
      .from("memorials")
      .update({
        ...(data.videoUrl !== undefined ? { video_url: data.videoUrl || null } : {}),
        ...(data.scheduleText !== undefined ? { schedule_text: data.scheduleText } : {}),
        ...(data.isPublic !== undefined ? { is_public: data.isPublic } : {}),
        ...(shareToken ? { share_token: shareToken } : {}),
      })
      .eq("id", data.memorialId)
      .select("id, share_token, is_public, video_url, schedule_text, title")
      .single();
    if (upErr) throw new Error(upErr.message);
    return row;
  });

/** Create digital wreath + PromptPay QR when amount > 0. */
export const createWreathPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        memorialId: z.string().uuid(),
        fromName: z.string().min(1).max(120),
        message: z.string().max(1000).default(""),
        amount: z.number().min(0).max(1_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: settings } = await supabaseAdmin
      .from("platform_settings")
      .select("funeral_promptpay_id, helpme_promptpay_id")
      .maybeSingle();
    const promptpayId =
      (settings as { funeral_promptpay_id?: string } | null)?.funeral_promptpay_id ||
      (settings as { helpme_promptpay_id?: string } | null)?.helpme_promptpay_id ||
      null;

    const amount = Number(data.amount) || 0;
    const payment_status = amount > 0 ? "pending" : "none";
    if (amount > 0 && !promptpayId) {
      throw new Error("PromptPay not configured (funeral_promptpay_id)");
    }

    const { data: row, error } = await supabaseAdmin
      .from("digital_wreaths")
      .insert({
        memorial_id: data.memorialId,
        from_name: data.fromName,
        message: data.message,
        amount,
        payment_status,
        promptpay_id: promptpayId,
      })
      .select("id, amount, payment_status, promptpay_id")
      .single();
    if (error) throw new Error(error.message);

    const amt = Number(row.amount);
    return {
      wreathId: row.id as string,
      amount: amt,
      paymentStatus: row.payment_status as string,
      promptpayId: row.promptpay_id as string | null,
      qrUrl:
        amt > 0 && row.promptpay_id
          ? `https://promptpay.io/${row.promptpay_id}/${amt.toFixed(2)}`
          : null,
    };
  });

/** Guest/public path: insert wreath without auth (same as client insert) + return QR. */
export const createWreathPaymentPublic = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        memorialId: z.string().uuid(),
        fromName: z.string().min(1).max(120),
        message: z.string().max(1000).default(""),
        amount: z.number().min(0).max(1_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: mem } = await supabaseAdmin
      .from("memorials")
      .select("id, is_public")
      .eq("id", data.memorialId)
      .maybeSingle();
    if (!mem?.is_public) throw new Error("Memorial not public");

    const { data: settings } = await supabaseAdmin
      .from("platform_settings")
      .select("funeral_promptpay_id, helpme_promptpay_id")
      .maybeSingle();
    const promptpayId =
      (settings as { funeral_promptpay_id?: string } | null)?.funeral_promptpay_id ||
      (settings as { helpme_promptpay_id?: string } | null)?.helpme_promptpay_id ||
      null;

    const amount = Number(data.amount) || 0;
    if (amount > 0 && !promptpayId) {
      throw new Error("PromptPay not configured");
    }

    const { data: row, error } = await supabaseAdmin
      .from("digital_wreaths")
      .insert({
        memorial_id: data.memorialId,
        from_name: data.fromName,
        message: data.message,
        amount,
        payment_status: amount > 0 ? "pending" : "none",
        promptpay_id: promptpayId,
      })
      .select("id, amount, payment_status, promptpay_id")
      .single();
    if (error) throw new Error(error.message);

    const amt = Number(row.amount);
    return {
      wreathId: row.id as string,
      amount: amt,
      paymentStatus: row.payment_status as string,
      qrUrl:
        amt > 0 && row.promptpay_id
          ? `https://promptpay.io/${row.promptpay_id}/${amt.toFixed(2)}`
          : null,
    };
  });

export const markWreathPaid = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        wreathId: z.string().uuid(),
        payerRef: z.string().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("digital_wreaths")
      .update({
        payment_status: "paid",
        payer_ref: data.payerRef ?? null,
      })
      .eq("id", data.wreathId)
      .select("id, payment_status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
