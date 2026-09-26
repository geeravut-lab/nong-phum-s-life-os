import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SsoErrorCode, SsoExchangeResult } from "./sso.server";

// No auth middleware: the caller is, by definition, not signed in yet.
// The ticket never leaves the server after this point — the hub is contacted
// from sso.server.ts, not from the browser.

export type SsoExchangeResponse =
  ({ ok: true } & SsoExchangeResult) | { ok: false; code: SsoErrorCode; status: number };

export const exchangeSsoTicket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ ticket: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data }): Promise<SsoExchangeResponse> => {
    const { runSsoExchange, SsoError } = await import("./sso.server");
    try {
      const result = await runSsoExchange(data.ticket);
      return { ok: true, ...result };
    } catch (err) {
      // Server functions cannot set an HTTP status on a returned value, so the
      // status travels in the body. The message stays on the server (logged
      // there); the client gets a code it can translate.
      if (err instanceof SsoError) return { ok: false, code: err.code, status: err.status };
      throw err;
    }
  });
