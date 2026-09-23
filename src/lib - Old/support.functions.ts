import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin, requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// "สนับสนุน" (donations). Every write goes through here under the caller's
// own JWT, so the table policies are the second gate behind the middleware:
// a donor's insert can only be 'pending'; settling is admin-only and stamps
// who did it. Reads of one's own rows happen straight from the page (RLS).
//
// Nothing in this file reads or writes user_roles, plans or feature flags.
// A donation changes numbers in a report and nothing else.

export const DONATION_MIN = 1;
export const DONATION_MAX = 100_000;
export const ANONYMOUS_DISPLAY_NAME = "ผู้ไม่ประสงค์ออกนาม";

export function isValidPromptPayId(digits: string): boolean {
  return [10, 13, 15].includes(digits.length) && /^[0-9]+$/.test(digits);
}

export type DonationSettings = { promptpay_id: string | null; enabled: boolean; purpose: string };

/** What the support page needs: settings (whether the channel is open) — donations themselves are read via RLS. */
export const getSupportConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DonationSettings & { active: boolean }> => {
    const { data, error } = await context.supabase
      .from("donation_settings")
      .select("promptpay_id, enabled, purpose")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    const s = data ?? { promptpay_id: null, enabled: false, purpose: "" };
    // Playbook §2.3: enabled AND an id present, otherwise the form must not show.
    return { ...s, active: s.enabled && !!s.promptpay_id };
  });

const CreateInput = z.object({
  amountBaht: z.number().min(DONATION_MIN).max(DONATION_MAX).multipleOf(0.01),
  ref: z.string().trim().max(40).optional(),
  anonymous: z.boolean(),
});

/** The donor reports a transfer. Always lands as 'pending'. */
export const createDonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: s, error: sErr } = await context.supabase
      .from("donation_settings")
      .select("promptpay_id, enabled")
      .eq("id", true)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!s?.enabled || !s.promptpay_id) throw new Error("donations are not enabled");

    // Anonymous means the row carries no email and a fixed name — stored that
    // way, not merely hidden (playbook §2.6).
    let display_name: string = ANONYMOUS_DISPLAY_NAME;
    let email: string | null = null;
    if (!data.anonymous) {
      const [{ data: profile }, { data: auth }] = await Promise.all([
        context.supabase.from("profiles").select("display_name").eq("id", context.userId).maybeSingle(),
        context.supabase.auth.getUser(),
      ]);
      display_name = profile?.display_name || auth.user?.email || context.userId.slice(0, 8);
      email = auth.user?.email ?? null;
    }

    const { data: row, error } = await context.supabase
      .from("donations")
      .insert({
        user_id: context.userId,
        anonymous: data.anonymous,
        display_name,
        email,
        amount_baht: data.amountBaht,
        promptpay_id: s.promptpay_id, // snapshot
        ref: data.ref || null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id };
  });

// ---- admin --------------------------------------------------------------

const SettleInput = z.object({ id: z.string().uuid(), status: z.enum(["confirmed", "rejected"]) });

/** "ยืนยันรับเงิน" / "ไม่พบรายการ". Stamps the audit trail; touches nothing else. */
export const settleDonation = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => SettleInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("donations")
      .update({ status: data.status, confirmed_at: new Date().toISOString(), confirmed_by: context.userId })
      .eq("id", data.id)
      .eq("status", "pending") // settle once; a second click on a stale card does nothing
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("already settled");
    return { ok: true as const };
  });

const SettingsInput = z.object({
  promptpayId: z.string().trim(),
  enabled: z.boolean(),
  purpose: z.string().max(2000),
});

export const updateDonationSettings = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => SettingsInput.parse(input))
  .handler(async ({ data, context }) => {
    const digits = data.promptpayId.replace(/[^0-9]/g, "");
    if (digits && !isValidPromptPayId(digits)) throw new Error("promptpay_id must be 10, 13 or 15 digits");
    const { error } = await context.supabase
      .from("donation_settings")
      .update({
        promptpay_id: digits || null,
        enabled: data.enabled,
        purpose: data.purpose.trim(),
        updated_by: context.userId,
      })
      .eq("id", true);
    if (error) throw error;
    return { ok: true as const };
  });

/** Confirmed rows only, newest first, capped — the page filters by period in memory. */
export const getDonationReport = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("donations")
      .select("id, user_id, display_name, email, amount_baht, ref, confirmed_at, created_at")
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      at: r.confirmed_at ?? r.created_at,
      amountBaht: Number(r.amount_baht) || 0,
      donorKey: r.user_id,
      who: r.display_name || r.email || `${r.user_id.slice(0, 8)}…`,
      ref: r.ref,
    }));
  });
