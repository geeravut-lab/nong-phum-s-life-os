import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Will & Estate.
 *
 * Records where the real will is and who to contact about it. It does not
 * draft, hold or execute one - see the migration for why there is deliberately
 * no field to type a will into.
 */

export type WillRecord = {
  hasWill: boolean;
  willKind: "handwritten" | "amphoe" | "lawyer" | "other";
  madeOn: string | null;
  locationHint: string;
  executorName: string;
  executorContact: string;
  lawyerName: string;
  lawyerContact: string;
  documentId: string | null;
  notes: string;
};

const EMPTY: WillRecord = {
  hasWill: false,
  willKind: "other",
  madeOn: null,
  locationHint: "",
  executorName: "",
  executorContact: "",
  lawyerName: "",
  lawyerContact: "",
  documentId: null,
  notes: "",
};

export const getMyWill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("legacy_will")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) return { will: EMPTY };
    return {
      will: {
        hasWill: !!data.has_will,
        willKind: (data.will_kind as WillRecord["willKind"]) ?? "other",
        madeOn: (data.made_on as string | null) ?? null,
        locationHint: (data.location_hint as string) ?? "",
        executorName: (data.executor_name as string) ?? "",
        executorContact: (data.executor_contact as string) ?? "",
        lawyerName: (data.lawyer_name as string) ?? "",
        lawyerContact: (data.lawyer_contact as string) ?? "",
        documentId: (data.document_id as string | null) ?? null,
        notes: (data.notes as string) ?? "",
      } satisfies WillRecord,
    };
  });

export const saveMyWill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        hasWill: z.boolean(),
        willKind: z.enum(["handwritten", "amphoe", "lawyer", "other"]),
        madeOn: z.string().nullable().optional(),
        locationHint: z.string().max(500).optional(),
        executorName: z.string().max(120).optional(),
        executorContact: z.string().max(200).optional(),
        lawyerName: z.string().max(120).optional(),
        lawyerContact: z.string().max(200).optional(),
        documentId: z.string().uuid().nullable().optional(),
        notes: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;

    // A referenced scan has to be the caller's own document.
    if (data.documentId) {
      const { data: doc } = await supabaseAdmin
        .from("documents")
        .select("id, user_id")
        .eq("id", data.documentId)
        .maybeSingle();
      if (!doc || doc.user_id !== uid) throw new Error("Forbidden");
    }

    const { error } = await supabaseAdmin.from("legacy_will").upsert(
      {
        user_id: uid,
        has_will: data.hasWill,
        will_kind: data.willKind,
        made_on: data.madeOn || null,
        location_hint: data.locationHint?.trim() ?? "",
        executor_name: data.executorName?.trim() ?? "",
        executor_contact: data.executorContact?.trim() ?? "",
        lawyer_name: data.lawyerName?.trim() ?? "",
        lawyer_contact: data.lawyerContact?.trim() ?? "",
        document_id: data.documentId ?? null,
        notes: data.notes?.trim() ?? "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
