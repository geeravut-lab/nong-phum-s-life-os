import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LineLinkErrorCode, LineLinkView } from "./line-link.server";

// All four require the caller to be signed in: a LINE link only ever attaches
// to the account of whoever is calling. Errors travel as codes in the body
// (server functions cannot set an HTTP status); details stay in server logs.

export type LineLinkStatus = { link: LineLinkView | null; addFriendUrl: string | null; configured: boolean };

export type LineLinkOutcome = { ok: true; link: LineLinkView } | { ok: false; code: LineLinkErrorCode };

const origin = z.string().url().max(200);

export const getLineLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LineLinkStatus> => {
    const { getLink, addFriendUrl } = await import("./line-link.server");
    return {
      link: await getLink(context.userId),
      addFriendUrl: addFriendUrl(),
      configured: !!(process.env["LINE_LOGIN_CHANNEL_ID"] && process.env["LINE_LOGIN_CHANNEL_SECRET"]),
    };
  });

export const startLineLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ origin }).parse(input))
  .handler(async ({ data, context }) => {
    const { startLink } = await import("./line-link.server");
    return startLink(context.userId, data.origin);
  });

export const finishLineLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        origin,
        code: z.string().min(1).max(500),
        state: z.string().min(1).max(200),
        friendshipStatusChanged: z.boolean().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<LineLinkOutcome> => {
    const { finishLink, LineLinkError } = await import("./line-link.server");
    try {
      const link = await finishLink({ userId: context.userId, ...data });
      return { ok: true, link };
    } catch (err) {
      if (err instanceof LineLinkError) {
        console.warn(`[line] link failed user=${context.userId} code=${err.code}: ${err.message}`);
        return { ok: false, code: err.code };
      }
      throw err;
    }
  });

export const unlinkLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { unlink } = await import("./line-link.server");
    await unlink(context.userId);
    return { ok: true as const };
  });
