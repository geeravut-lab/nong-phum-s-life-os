import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isAllowedUrl, signPayload } from "@/lib/webhooks.server";

/** A user's own webhooks. The secret is returned only when it is created. */
export const listWebhooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("webhook_endpoints")
      .select("id, url, events, is_active, last_status, last_at, failure_count, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { endpoints: data ?? [] };
  });

export const createWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        url: z.string().url().max(500),
        events: z.array(z.string().max(60)).max(20).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!isAllowedUrl(data.url)) throw new Error("app:webhook_bad_url");

    // Three is not a technical limit; it is enough for a person and small
    // enough that one account cannot turn the notifier into a fan-out engine.
    const { count } = await supabaseAdmin
      .from("webhook_endpoints")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);
    if ((count ?? 0) >= 3) throw new Error("app:webhook_limit");

    const { data: row, error } = await supabaseAdmin
      .from("webhook_endpoints")
      .insert({ user_id: context.userId, url: data.url, events: data.events })
      .select("id, url, secret, events")
      .single();
    if (error) throw new Error(error.message);
    // The only time the secret is ever returned: the receiver needs it to
    // verify signatures, and it is not readable again afterwards.
    return { id: row.id, url: row.url, secret: row.secret, events: row.events };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("webhook_endpoints")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Send a signed test post, and report exactly what came back. */
export const testWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row } = await supabaseAdmin
      .from("webhook_endpoints")
      .select("id, url, secret")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!row) throw new Error("not found");
    if (!isAllowedUrl(row.url as string)) throw new Error("app:webhook_bad_url");

    const body = JSON.stringify({
      kind: "test",
      title: "Life OS webhook test",
      body: "",
      href: "/settings",
      params: {},
      at: new Date().toISOString(),
    });

    let status = 0;
    let message = "";
    try {
      const res = await fetch(row.url as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LifeOS-Event": "test",
          "X-LifeOS-Signature": signPayload(row.secret as string, body),
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      status = res.status;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }

    await supabaseAdmin
      .from("webhook_endpoints")
      .update({
        last_status: status,
        last_at: new Date().toISOString(),
        // A successful test clears the failure count: the user has just proved
        // the endpoint works, whatever happened before.
        ...(status >= 200 && status < 300 ? { failure_count: 0, is_active: true } : {}),
      })
      .eq("id", row.id as string);

    return { status, message };
  });
