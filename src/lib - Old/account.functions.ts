import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// What the user must type to confirm. Either language is accepted regardless
// of the UI language, so switching languages mid-dialog cannot lock them out.
export const DELETE_CONFIRMATION_PHRASES = ["ลบบัญชี", "DELETE"] as const;

export const getDeletionPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { deletionPreview } = await import("./account.server");
    return deletionPreview(context.supabase, context.userId);
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ confirmation: z.string().trim().max(50) }).parse(input))
  .handler(async ({ data, context }) => {
    // Checked on the server too: the dialog's disabled button is UX, not a guard.
    if (!(DELETE_CONFIRMATION_PHRASES as readonly string[]).includes(data.confirmation)) {
      throw new Error("confirmation phrase does not match");
    }
    const { deleteAccount } = await import("./account.server");
    return deleteAccount(context.supabase, context.userId);
  });
