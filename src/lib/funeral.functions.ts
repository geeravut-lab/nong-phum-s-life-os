import { assertFeature } from "@/lib/flags.server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin, requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyAdmins, notifyUsers } from "@/lib/notify.server";
import { installmentSchedule } from "@/lib/funeral.shared";
import { userLabel } from "./family-labels.server";
import { bahtTH, dayTH, noticeBody, whenTH } from "./notice-detail";

export const planFuneral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        budget: z.number().nullable().optional(),
        religion: z.string().min(1).max(80),
        province: z.string().min(1).max(80),
        days: z.number().nullable().optional(),
        guests: z.number().nullable().optional(),
        style: z.string().max(120).default(""),
        extras: z.string().max(1000).default(""),
        lang: z.enum(["th", "en"]).default("th"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Switched off means no new plans, not just a hidden form.
    await assertFeature("funeral_planner");
    const { buildFuneralPackages } = await import("./funeral.server");
    const packages = await buildFuneralPackages({
      budget: data.budget ?? null,
      religion: data.religion,
      province: data.province,
      days: data.days ?? null,
      guests: data.guests ?? null,
      style: data.style,
      extras: data.extras,
      lang: data.lang,
    });
    const { data: row, error } = await context.supabase
      .from("funeral_plans")
      .insert({
        user_id: context.userId,
        input: data,
        packages: packages.packages,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { planId: row.id, ...packages };
  });

/**
 * The user picks one of the three packages, and an admin is asked to check it.
 *
 * Paying used to be the same action as choosing, which left nobody to confirm
 * that the venue, the monks and the caterer in the package can actually be
 * booked. Now choosing puts the plan in front of an admin and stops there.
 */
export const selectFuneralPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        packageId: z.enum(["economy", "standard", "premium"]),
        representativeName: z.string().max(120).optional(),
        representativeContact: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // A plan chosen while the feature is off would sit in an admin queue nobody is working.
    await assertFeature("funeral_planner");
    const { data: plan, error } = await context.supabase
      .from("funeral_plans")
      .select("id, user_id, packages")
      .eq("id", data.planId)
      .single();
    if (error || !plan) throw new Error(error?.message ?? "plan not found");
    if (plan.user_id !== context.userId) throw new Error("Forbidden");

    const pkgs = (plan.packages as Array<{ id: string; name?: string; totalBudget: number }>) ?? [];
    const selected = pkgs.find((x) => x.id === data.packageId);
    if (!selected) throw new Error("Package not found");

    const { error: upErr } = await context.supabase
      .from("funeral_plans")
      .update({
        selected_package: data.packageId,
        total_budget: selected.totalBudget,
        status: "selected",
        admin_status: "reviewing",
        ...(data.representativeName ? { representative_name: data.representativeName } : {}),
        ...(data.representativeContact
          ? { representative_contact: data.representativeContact }
          : {}),
      })
      .eq("id", data.planId);
    if (upErr) throw new Error(upErr.message);

    await notifyAdmins(
      {
        kind: "funeral_selected",
        params: {
          packageName: selected.name ?? data.packageId,
          total: Number(selected.totalBudget),
        },
        title: "มีผู้เลือกแพ็กเกจงานศพ",
        body: noticeBody("ต้องติดต่อสถานที่และผู้ให้บริการเพื่อยืนยัน", [
          ["ผู้เลือก", await userLabel(context.userId)],
          ["แพ็กเกจ", selected.name ?? data.packageId],
          ["งบรวม", bahtTH(Number(selected.totalBudget))],
        ]),
        href: "/admin/funeral",
        refTable: "funeral_plans",
        refId: data.planId,
      },
      context.userId,
    );

    return { ok: true as const, totalBudget: Number(selected.totalBudget) };
  });

/** Arrange it yourself, or have the platform do it. Only after an admin confirms. */
export const setFuneralFulfilment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ planId: z.string().uuid(), mode: z.enum(["self", "platform"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: plan, error } = await context.supabase
      .from("funeral_plans")
      .select("id, user_id, admin_status")
      .eq("id", data.planId)
      .single();
    if (error || !plan) throw new Error(error?.message ?? "plan not found");
    if (plan.user_id !== context.userId) throw new Error("Forbidden");
    if (plan.admin_status !== "confirmed") throw new Error("not confirmed yet");

    const { error: upErr } = await context.supabase
      .from("funeral_plans")
      .update({ fulfilment: data.mode })
      .eq("id", data.planId);
    if (upErr) throw new Error(upErr.message);

    await notifyAdmins(
      {
        kind: "funeral_fulfilment",
        params: { mode: data.mode },
        title: "ผู้ใช้เลือกวิธีดำเนินการงานศพ",
        body: noticeBody(
          data.mode === "platform" ? "ให้แพลตฟอร์มดำเนินการให้" : "ผู้ใช้จะดำเนินการเอง",
          [["ผู้เลือก", await userLabel(context.userId)]],
        ),
        href: "/admin/funeral",
        refTable: "funeral_plans",
        refId: data.planId,
      },
      context.userId,
    );
    return { ok: true as const };
  });

/** The plan as the owner sees it: status, instalments, evidence. */
export const getMyFuneralPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ planId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("funeral_plans")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data.planId) q = context.supabase.from("funeral_plans").select("*").eq("id", data.planId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const plan = rows?.[0] ?? null;
    if (!plan) return { plan: null, installments: [], evidence: [], payments: [] };

    const [inst, ev, pays] = await Promise.all([
      context.supabase.from("funeral_installments").select("*").eq("plan_id", plan.id).order("seq"),
      context.supabase
        .from("funeral_evidence")
        .select("*")
        .eq("plan_id", plan.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("funeral_payments")
        .select("*")
        .eq("plan_id", plan.id)
        .order("created_at", { ascending: false }),
    ]);

    return {
      plan,
      installments: inst.data ?? [],
      evidence: ev.data ?? [],
      payments: pays.data ?? [],
    };
  });

export const createFuneralPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        packageId: z.enum(["economy", "standard", "premium"]),
        installments: z.union([z.literal(1), z.literal(12), z.literal(24), z.literal(36)]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Never take money for a service that is currently switched off.
    await assertFeature("funeral_planner");
    const { data: plan, error } = await context.supabase
      .from("funeral_plans")
      .select("id, user_id, packages, status, admin_status, fulfilment")
      .eq("id", data.planId)
      .single();
    if (error || !plan) throw new Error(error?.message ?? "plan not found");
    if (plan.user_id !== context.userId) throw new Error("Forbidden");
    // Paying is the last step, not the first: an admin has to have confirmed
    // the package can be delivered, and the user has to have asked the platform
    // to run it. Someone arranging it themselves pays the providers directly.
    if (plan.admin_status !== "confirmed") throw new Error("not confirmed yet");
    if (plan.fulfilment !== "platform") throw new Error("not a platform-run plan");

    const pkgs = (plan.packages as Array<{ id: string; totalBudget: number }>) ?? [];
    const selected = pkgs.find((x) => x.id === data.packageId);
    if (!selected) throw new Error("Package not found");

    const { data: settings } = await supabaseAdmin
      .from("platform_settings")
      .select("funeral_promptpay_id, helpme_promptpay_id")
      .maybeSingle();
    const promptpayId =
      (settings as { funeral_promptpay_id?: string; helpme_promptpay_id?: string } | null)
        ?.funeral_promptpay_id ??
      (settings as { helpme_promptpay_id?: string } | null)?.helpme_promptpay_id ??
      null;

    const total = Number(selected.totalBudget);
    const schedule = installmentSchedule(total, data.installments);
    const firstAmount = schedule[0]?.amount ?? total;

    await context.supabase
      .from("funeral_plans")
      .update({
        selected_package: data.packageId,
        total_budget: total,
        status: "selected",
      })
      .eq("id", data.planId);

    // One row per instalment, so "what do I owe this month" has an answer.
    // Rebuilt from scratch if the user changes their mind about the term.
    //
    // Paying in one go writes a row too, though it is a schedule of one. It
    // used to write none, which left that payer with a QR and nowhere to say
    // they had paid it - the row is what carries the reference and the admin's
    // check, so without it a single payment could never be confirmed.
    await supabaseAdmin.from("funeral_installments").delete().eq("plan_id", data.planId);
    const { error: insErr } = await supabaseAdmin.from("funeral_installments").insert(
      schedule.map((row) => ({
        plan_id: data.planId,
        seq: row.seq,
        due_on: row.dueOn,
        amount: row.amount,
      })),
    );
    if (insErr) throw new Error(insErr.message);

    const { data: pay, error: payErr } = await context.supabase
      .from("funeral_payments")
      .insert({
        plan_id: data.planId,
        payer_id: context.userId,
        amount: firstAmount,
        installments: data.installments,
        payment_status: "pending",
        promptpay_id: promptpayId,
      })
      .select("id, amount")
      .single();
    if (payErr) throw new Error(payErr.message);

    const amt = Number(pay.amount);
    return {
      paymentId: pay.id,
      amount: amt,
      promptpayId,
      qrUrl: promptpayId ? `https://promptpay.io/${promptpayId}/${amt.toFixed(2)}` : null,
      installments: data.installments,
      total,
      schedule,
    };
  });

export const markFuneralPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ paymentId: z.string().uuid(), payerRef: z.string().max(80).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const isAdmin = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { data: pay, error } = await context.supabase
      .from("funeral_payments")
      .select("id, plan_id, payer_id, payment_status")
      .eq("id", data.paymentId)
      .single();
    if (error || !pay) throw new Error(error?.message ?? "not found");
    if (pay.payer_id !== context.userId && !isAdmin.data) throw new Error("Forbidden");

    await context.supabase
      .from("funeral_payments")
      .update({
        payment_status: "paid",
        payer_ref: data.payerRef ?? null,
        paid_at: new Date().toISOString(),
      })
      .eq("id", data.paymentId);
    await context.supabase.from("funeral_plans").update({ status: "paid" }).eq("id", pay.plan_id);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Admin side of the plan: contact the providers, say whether it can be done,
// and put the paperwork where the user can see it.
// ---------------------------------------------------------------------------

/** The queue: plans waiting on an admin, newest first. */
export const adminListFuneralPlans = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({ status: z.enum(["all", "reviewing", "confirmed", "declined"]).default("all") })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("funeral_plans")
      .select("*")
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status !== "all") q = q.eq("admin_status", data.status);
    const { data: plans, error } = await q;
    if (error) throw new Error(error.message);

    const ids = (plans ?? []).map((p) => p.id);
    const owners = [...new Set((plans ?? []).map((p) => p.user_id).filter(Boolean))] as string[];

    // Names for the queue: the admin needs to know whose plan this is.
    const { data: profiles } = owners.length
      ? await supabaseAdmin.from("profiles").select("id, display_name").in("id", owners)
      : { data: [] as Array<{ id: string; display_name: string | null }> };
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? null]));

    const [inst, ev, pays] = await Promise.all([
      ids.length
        ? supabaseAdmin.from("funeral_installments").select("*").in("plan_id", ids).order("seq")
        : { data: [] },
      ids.length
        ? supabaseAdmin.from("funeral_evidence").select("*").in("plan_id", ids)
        : { data: [] },
      ids.length
        ? supabaseAdmin.from("funeral_payments").select("*").in("plan_id", ids)
        : { data: [] },
    ]);

    return {
      plans: (plans ?? []).map((p) => ({
        ...p,
        ownerName: nameById.get(p.user_id as string) ?? null,
        installments: (inst.data ?? []).filter((i) => i.plan_id === p.id),
        evidence: (ev.data ?? []).filter((e) => e.plan_id === p.id),
        payments: (pays.data ?? []).filter((x) => x.plan_id === p.id),
      })),
    };
  });

/** Admin says whether the package can actually be delivered, and the user is told. */
export const adminReviewFuneralPlan = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        decision: z.enum(["reviewing", "confirmed", "declined"]),
        notes: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: plan } = await supabaseAdmin
      .from("funeral_plans")
      .select("id, user_id, selected_package")
      .eq("id", data.planId)
      .maybeSingle();
    if (!plan) throw new Error("plan not found");

    const { error } = await supabaseAdmin
      .from("funeral_plans")
      .update({
        admin_status: data.decision,
        admin_reviewed_at: new Date().toISOString(),
        admin_reviewed_by: context.userId,
        ...(data.notes !== undefined ? { admin_notes: data.notes } : {}),
        // Confirmed means the user can now choose how it gets arranged.
        ...(data.decision === "confirmed" ? { status: "confirmed" as const } : {}),
      })
      .eq("id", data.planId);
    if (error) throw new Error(error.message);

    await notifyUsers(
      [plan.user_id],
      {
        kind: "funeral_review",
        params: { decision: data.decision, note: data.notes?.trim() ?? "" },
        title:
          data.decision === "confirmed"
            ? "แพ็กเกจงานศพยืนยันได้แล้ว"
            : data.decision === "declined"
              ? "แพ็กเกจงานศพยังดำเนินการไม่ได้"
              : "กำลังตรวจสอบแพ็กเกจงานศพ",
        body: noticeBody(
          data.notes?.trim()
            ? data.notes.trim().slice(0, 300)
            : data.decision === "confirmed"
              ? "เลือกได้แล้วว่าจะดำเนินการเองหรือให้แพลตฟอร์มดำเนินการให้"
              : "เปิดดูรายละเอียดในเมนูมรดกแห่งชีวิต",
          [
            ["แพ็กเกจ", plan.selected_package],
            [
              "ผลการตรวจ",
              data.decision === "confirmed"
                ? "ยืนยันแล้ว"
                : data.decision === "declined"
                  ? "ยังดำเนินการไม่ได้"
                  : "กำลังตรวจสอบ",
            ],
            ["ตรวจเมื่อ", whenTH(new Date().toISOString())],
          ],
        ),
        href: "/legacy/after",
        refTable: "funeral_plans",
        refId: data.planId,
      },
      context.userId,
    );
    return { ok: true as const };
  });

/**
 * Attach a document to the plan: who was contacted, the insurance, a receipt.
 *
 * The file goes into the existing documents bucket under the plan owner's own
 * folder, written with the service role because storage RLS would stop an admin
 * writing into someone else's folder - and read back by the owner through the
 * policy that is already there. One bucket, no new deployment step.
 */
export const addFuneralEvidence = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        kind: z.enum(["provider_contact", "insurance", "payment", "other"]),
        title: z.string().min(1).max(160),
        note: z.string().max(2000).default(""),
        file: z
          .object({
            base64: z.string().min(1),
            mimeType: z.string().min(1).max(120),
            fileName: z.string().min(1).max(160),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: plan } = await supabaseAdmin
      .from("funeral_plans")
      .select("id, user_id")
      .eq("id", data.planId)
      .maybeSingle();
    if (!plan) throw new Error("plan not found");

    let filePath: string | null = null;
    if (data.file) {
      const bytes = Buffer.from(data.file.base64, "base64");
      // 8 MB: a photo of a contract or a signed policy, not a video.
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("file too large");
      const safe = data.file.fileName.replace(/[^\w.\-ก-๙ ]+/g, "_").slice(0, 80);
      filePath = `${plan.user_id}/funeral-evidence/${data.planId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("documents")
        .upload(filePath, bytes, { contentType: data.file.mimeType, upsert: false });
      if (upErr) throw new Error(upErr.message);
    }

    const { error } = await supabaseAdmin.from("funeral_evidence").insert({
      plan_id: data.planId,
      kind: data.kind,
      title: data.title.trim(),
      note: data.note.trim(),
      file_path: filePath,
      uploaded_by: context.userId,
    });
    if (error) throw new Error(error.message);

    await notifyUsers(
      [plan.user_id],
      {
        kind: "funeral_evidence",
        params: { title: data.title.trim() },
        title: "มีหลักฐานใหม่ในแผนงานศพของคุณ",
        body: noticeBody(data.title.trim().slice(0, 300), [
          ["ประเภท", data.kind],
          ["เพิ่มโดย", await userLabel(context.userId)],
          ["บันทึก", data.note.trim()],
          ["ไฟล์แนบ", filePath ? "มี" : "ไม่มี"],
        ]),
        href: "/legacy/after",
        refTable: "funeral_evidence",
        refId: data.planId,
      },
      context.userId,
    );
    return { ok: true as const, filePath };
  });

/** A signed link to one evidence file, for the owner or an admin. */
export const getFuneralEvidenceUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ evidenceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row } = await supabaseAdmin
      .from("funeral_evidence")
      .select("id, plan_id, file_path")
      .eq("id", data.evidenceId)
      .maybeSingle();
    if (!row?.file_path) throw new Error("no file");

    const { data: plan } = await supabaseAdmin
      .from("funeral_plans")
      .select("user_id")
      .eq("id", row.plan_id)
      .maybeSingle();
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (plan?.user_id !== context.userId && isAdmin !== true) throw new Error("Forbidden");

    const { data: signed, error } = await supabaseAdmin.storage
      .from("documents")
      .createSignedUrl(row.file_path, 300);
    if (error) throw new Error(error.message);
    return { url: signed?.signedUrl ?? null };
  });

/**
 * Correct a piece of evidence an admin already filed.
 *
 * A typo in a provider's name, a note that turned out to be wrong, or the wrong
 * photo attached: before this the only way out was to delete the row and add it
 * again, which sent the owner a second "new evidence" notification for
 * something they had already been told about. A replaced file leaves the old
 * object behind on purpose - it is what the owner may already have opened, and
 * deleting it is the delete below, deliberately.
 */
export const updateFuneralEvidence = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        evidenceId: z.string().uuid(),
        kind: z.enum(["provider_contact", "insurance", "payment", "other"]),
        title: z.string().min(1).max(160),
        note: z.string().max(2000).default(""),
        file: z
          .object({
            base64: z.string().min(1),
            mimeType: z.string().min(1).max(120),
            fileName: z.string().min(1).max(160),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("funeral_evidence")
      .select("id, plan_id")
      .eq("id", data.evidenceId)
      .maybeSingle();
    if (!row) throw new Error("evidence not found");

    const { data: plan } = await supabaseAdmin
      .from("funeral_plans")
      .select("id, user_id")
      .eq("id", row.plan_id)
      .maybeSingle();
    if (!plan) throw new Error("plan not found");

    let filePath: string | null = null;
    if (data.file) {
      const bytes = Buffer.from(data.file.base64, "base64");
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("file too large");
      const safe = data.file.fileName.replace(/[^\w.\-ก-๙ ]+/g, "_").slice(0, 80);
      filePath = `${plan.user_id}/funeral-evidence/${row.plan_id}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("documents")
        .upload(filePath, bytes, { contentType: data.file.mimeType, upsert: false });
      if (upErr) throw new Error(upErr.message);
    }

    const { data: written, error } = await supabaseAdmin
      .from("funeral_evidence")
      .update({
        kind: data.kind,
        title: data.title.trim(),
        note: data.note.trim(),
        // No new file means keep the one that is there, not clear it.
        ...(filePath ? { file_path: filePath } : {}),
      })
      .eq("id", data.evidenceId)
      .select("id");
    if (error) throw new Error(error.message);
    // PostgREST answers an update that matched nothing with a success, so the
    // row count is the only thing that says it happened.
    if (!written || written.length === 0) throw new Error("evidence not found");

    return { ok: true as const, filePath };
  });

/** Remove a piece of evidence, and the file it was standing for. */
export const deleteFuneralEvidence = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => z.object({ evidenceId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("funeral_evidence")
      .select("id, file_path")
      .eq("id", data.evidenceId)
      .maybeSingle();
    if (!row) throw new Error("evidence not found");

    const { data: gone, error } = await supabaseAdmin
      .from("funeral_evidence")
      .delete()
      .eq("id", data.evidenceId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!gone || gone.length === 0) throw new Error("evidence not found");

    // The row is the only thing that pointed at the object, so it goes too -
    // after the row, so a failed storage call cannot leave a record pointing at
    // a file that is no longer there.
    if (row.file_path) {
      const { error: rmErr } = await supabaseAdmin.storage
        .from("documents")
        .remove([row.file_path as string]);
      if (rmErr) console.error("[funeral] evidence file remove failed:", rmErr.message);
    }
    return { ok: true as const };
  });

/**
 * Where the money for this plan should be sent.
 *
 * The funeral account if one is set, otherwise the same PromptPay id the rest
 * of the app collects on - a plan that cannot show a QR is a plan nobody can
 * pay, so falling back beats showing nothing.
 */
async function funeralPromptpayId(): Promise<string | null> {
  const { data: settings } = await supabaseAdmin
    .from("platform_settings")
    .select("funeral_promptpay_id, helpme_promptpay_id")
    .maybeSingle();
  const s = settings as {
    funeral_promptpay_id?: string | null;
    helpme_promptpay_id?: string | null;
  } | null;
  return s?.funeral_promptpay_id ?? s?.helpme_promptpay_id ?? null;
}

/** promptpay.io renders the QR; the amount is baked in so it cannot be mistyped. */
function promptpayQr(id: string | null, amount: number): string | null {
  return id ? `https://promptpay.io/${id}/${amount.toFixed(2)}` : null;
}

/** An instalment is waiting on an admin either way; see the migration. */
const INSTALLMENT_IN_REVIEW = (row: {
  payment_status?: string | null;
  payer_ref?: string | null;
}) => row.payment_status === "review" || (row.payment_status === "due" && !!row.payer_ref);

/**
 * The QR for one instalment, so the payer sees the amount they owe this month.
 *
 * Separate from createFuneralPayment, which sets the whole schedule up once.
 * This is the monthly act: open the row, pay it, say you did.
 */
export const startFuneralInstallmentPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ installmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertFeature("funeral_planner");
    const { data: row } = await supabaseAdmin
      .from("funeral_installments")
      .select("id, plan_id, seq, amount, due_on, payment_status, payer_ref")
      .eq("id", data.installmentId)
      .maybeSingle();
    if (!row) throw new Error("not found");

    const { data: plan } = await supabaseAdmin
      .from("funeral_plans")
      .select("user_id")
      .eq("id", row.plan_id)
      .maybeSingle();
    if (plan?.user_id !== context.userId) throw new Error("Forbidden");

    const amount = Number(row.amount);
    const promptpayId = await funeralPromptpayId();
    return {
      installmentId: row.id as string,
      seq: row.seq as number,
      dueOn: row.due_on as string,
      amount,
      promptpayId,
      qrUrl: promptpayQr(promptpayId, amount),
      alreadyReported: INSTALLMENT_IN_REVIEW(row),
    };
  });

/**
 * "I have transferred it" - which is a claim, not a receipt.
 *
 * It used to write 'paid', so the plan counted money nobody had checked for.
 * Now it parks the row in review with whatever the payer can quote from their
 * slip, and tells the admins there is something to look at - the same loop
 * membership payments have always used.
 */
export const reportFuneralInstallmentPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        installmentId: z.string().uuid(),
        payerRef: z.string().trim().min(1).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await supabaseAdmin
      .from("funeral_installments")
      .select("id, plan_id, seq, amount, due_on, payment_status")
      .eq("id", data.installmentId)
      .maybeSingle();
    if (!row) throw new Error("not found");
    if (row.payment_status === "paid") return { ok: true as const, status: "paid" as const };

    const { data: plan } = await supabaseAdmin
      .from("funeral_plans")
      .select("user_id")
      .eq("id", row.plan_id)
      .maybeSingle();
    if (plan?.user_id !== context.userId) throw new Error("Forbidden");

    const reported = {
      payment_status: "review",
      payer_ref: data.payerRef,
      reported_at: new Date().toISOString(),
      review_note: null as string | null,
    };
    // reported_at / review_note are newer than the generated types, which are
    // built from the database as it was.
    let { error } = await supabaseAdmin
      .from("funeral_installments")
      .update(reported as never)
      .eq("id", data.installmentId);
    if (error) {
      // 23514 = the status CHECK predates 'review'; 42703/PGRST204 = the new
      // columns are not there yet. Either way 20260928130000 has not been
      // pushed, so the row stays 'due' carrying the reference - which the app
      // reads as "waiting on an admin" too.
      if (error.code === "23514" || error.code === "42703" || error.code === "PGRST204") {
        ({ error } = await supabaseAdmin
          .from("funeral_installments")
          .update({ payer_ref: data.payerRef })
          .eq("id", data.installmentId));
      }
      if (error) throw new Error(error.message);
    }

    const { count } = await supabaseAdmin
      .from("funeral_installments")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", row.plan_id)
      .in("payment_status", ["due", "review"]);

    await notifyAdmins(
      {
        kind: "funeral_installment",
        params: { seq: row.seq as number },
        title: "แจ้งชำระงวดค่างานศพ รอตรวจสอบ",
        body: noticeBody(`งวดที่ ${row.seq} รอผู้ดูแลระบบตรวจสอบ`, [
          ["ผู้ชำระ", await userLabel(context.userId)],
          ["ยอดงวดนี้", bahtTH(row.amount as number | null)],
          ["ครบกำหนด", dayTH(row.due_on as string | null)],
          ["อ้างอิงการโอน", data.payerRef],
          ["งวดที่ยังไม่ผ่านการตรวจ", String(count ?? 0)],
        ]),
        href: "/admin/funeral",
        refTable: "funeral_installments",
        refId: data.installmentId,
      },
      context.userId,
    );
    return { ok: true as const, status: "review" as const };
  });

/**
 * The admin end of that loop: the transfer is there, or it is not.
 *
 * Rejecting puts the row back to due rather than leaving it in limbo, with the
 * reason attached, so the payer can look again and report it properly.
 */
export const adminReviewFuneralInstallment = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        installmentId: z.string().uuid(),
        decision: z.enum(["confirm", "reject"]),
        note: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await supabaseAdmin
      .from("funeral_installments")
      .select("id, plan_id, seq, amount, due_on, payer_ref")
      .eq("id", data.installmentId)
      .maybeSingle();
    if (!row) throw new Error("not found");

    const { data: plan } = await supabaseAdmin
      .from("funeral_plans")
      .select("id, user_id")
      .eq("id", row.plan_id)
      .maybeSingle();
    if (!plan) throw new Error("plan not found");

    const confirmed = data.decision === "confirm";
    const patch = confirmed
      ? {
          payment_status: "paid",
          paid_at: new Date().toISOString(),
          review_note: data.note?.trim() || null,
        }
      : {
          payment_status: "due",
          payer_ref: null,
          paid_at: null,
          review_note: data.note?.trim() || null,
        };
    let { data: written, error } = await supabaseAdmin
      .from("funeral_installments")
      .update(patch as never)
      .eq("id", data.installmentId)
      .select("id");
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      // Same pre-migration database: write it without the review note.
      const { review_note: _drop, ...rest } = patch;
      ({ data: written, error } = await supabaseAdmin
        .from("funeral_installments")
        .update(rest as never)
        .eq("id", data.installmentId)
        .select("id"));
    }
    if (error) throw new Error(error.message);
    // An update that matched nothing reads as a success, so the row count is
    // what says the decision landed.
    if (!written || written.length === 0) throw new Error("not found");

    // The plan is paid once nothing is still due or waiting to be checked.
    const { count } = await supabaseAdmin
      .from("funeral_installments")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", row.plan_id)
      .in("payment_status", ["due", "review"]);
    if ((count ?? 0) === 0) {
      await supabaseAdmin.from("funeral_plans").update({ status: "paid" }).eq("id", row.plan_id);
    }

    await notifyUsers(
      [plan.user_id as string],
      {
        kind: "funeral_installment",
        params: { seq: row.seq as number },
        title: confirmed ? "ยืนยันการชำระงวดแล้ว" : "ยังตรวจไม่พบการโอนงวดนี้",
        body: noticeBody(
          confirmed
            ? `งวดที่ ${row.seq} ได้รับเงินเรียบร้อย`
            : `งวดที่ ${row.seq} ตรวจไม่พบรายการโอน กรุณาตรวจสอบและแจ้งใหม่อีกครั้ง`,
          [
            ["ยอดงวดนี้", bahtTH(row.amount as number | null)],
            ["ครบกำหนด", dayTH(row.due_on as string | null)],
            ["อ้างอิงที่แจ้งไว้", (row.payer_ref as string | null) ?? ""],
            ["หมายเหตุจากผู้ดูแลระบบ", data.note?.trim() ?? ""],
            ["งวดที่ยังค้าง", String(count ?? 0)],
          ],
        ),
        href: "/legacy/after",
        refTable: "funeral_installments",
        refId: data.installmentId,
      },
      context.userId,
    );
    return { ok: true as const, paid: confirmed };
  });

/**
 * Who receives the insurance money, and how to reach them.
 *
 * Collected next to the packages, then never shown again - so nobody could
 * check a wrong number or change their mind. The plan's owner can see and
 * correct it for as long as the plan is open.
 */
export const setFuneralRepresentative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        name: z.string().trim().max(120),
        contact: z.string().trim().max(120),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: written, error } = await context.supabase
      .from("funeral_plans")
      .update({
        representative_name: data.name || null,
        representative_contact: data.contact || null,
      })
      .eq("id", data.planId)
      .eq("user_id", context.userId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!written || written.length === 0) throw new Error("plan not found");
    return { ok: true as const };
  });
