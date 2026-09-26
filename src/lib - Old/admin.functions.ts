import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/auth-middleware";
import type { ModelOverrides, ProviderId, TaskKind } from "./ai-provider.server";

// Both functions chain requireAdmin, and the ai_settings UPDATE below also runs
// under the caller's own JWT, so the database's has_role policy is a second
// gate even if a middleware were ever bypassed.

const ProviderIdSchema = z.enum(["anthropic", "openai", "google"]);
const TaskSchema = z.enum(["chat", "document", "reasoning"]);

const ModelOverridesSchema = z
  .record(ProviderIdSchema, z.record(TaskSchema, z.string().trim().max(200)))
  .default({});

const UpdateInput = z.object({
  default_provider: ProviderIdSchema.nullable(),
  fallback_provider: z.union([ProviderIdSchema, z.literal("none")]).nullable(),
  model_overrides: ModelOverridesSchema,
});

export type UpdateAiSettingsInput = z.infer<typeof UpdateInput>;

/** Everything the admin page needs to render: DB row, per-provider facts, and what is in effect now. */
export const getAiConfig = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const ai = await import("./ai-provider.server");

    const { data: settings, error } = await context.supabase
      .from("ai_settings")
      .select("default_provider, fallback_provider, model_overrides, updated_at, updated_by")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;

    const { listAllModels, providerBaseUrl } = await import("./ai-models.server");
    const available = new Set(ai.availableProviders());
    const providers = ai.PROVIDER_IDS.map((id) => ({
      id,
      hasKey: available.has(id),
      envKey: ai.providerEnvKey(id),
      defaults: ai.defaultModelsFor(id),
      capabilities: ai.providerCapabilities(id),
      baseUrl: providerBaseUrl(id),
    }));

    const effectiveProvider = await ai.resolveProvider("config");
    const effectiveModels = Object.fromEntries(
      await Promise.all(
        ai.TASK_KINDS.map(async (task) => [task, await ai.resolveModelId(effectiveProvider, task)]),
      ),
    ) as Record<TaskKind, string>;

    // Live model catalogues for every provider that has a key (1h cache).
    const models = await listAllModels();

    // updated_by is a uuid; profiles RLS only lets a user read their own row,
    // so the editor's name is looked up server-side.
    let updatedByLabel: string | null = null;
    if (settings?.updated_by) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: p } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", settings.updated_by)
        .maybeSingle();
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(settings.updated_by);
      updatedByLabel = p?.display_name ?? u.user?.email ?? settings.updated_by;
    }

    return {
      settings: settings
        ? { ...settings, model_overrides: (settings.model_overrides ?? {}) as ModelOverrides }
        : null,
      updatedByLabel,
      providers,
      models,
      env: {
        AI_PROVIDER: process.env["AI_PROVIDER"]?.trim() || null,
        AI_FALLBACK_PROVIDER: process.env["AI_FALLBACK_PROVIDER"]?.trim() || null,
      },
      effective: { provider: effectiveProvider, models: effectiveModels },
      cacheTtlSeconds: 30,
    };
  });

/**
 * Save new settings. Refuses, with the missing variable named, to point at a
 * provider whose API key is absent — the place to find that out is here, not
 * when the next user taps a button.
 */
export const updateAiSettings = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => UpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const ai = await import("./ai-provider.server");
    const available = new Set(ai.availableProviders());

    for (const [field, value] of [
      ["default_provider", data.default_provider],
      ["fallback_provider", data.fallback_provider],
    ] as const) {
      if (value && value !== "none" && !available.has(value)) {
        throw new Error(
          `${field}: provider "${value}" cannot be selected because ${ai.providerEnvKey(value)} is not set in the environment.`,
        );
      }
    }
    if (data.fallback_provider && data.fallback_provider === data.default_provider) {
      throw new Error("fallback_provider must differ from default_provider (or be 'none').");
    }

    // Drop empty overrides so "cleared in the UI" means "use the default in code".
    const overrides: ModelOverrides = {};
    for (const [provider, tasks] of Object.entries(data.model_overrides)) {
      const kept = Object.fromEntries(
        Object.entries(tasks ?? {}).filter(([, v]) => v && v.trim() !== ""),
      );
      if (Object.keys(kept).length > 0) overrides[provider as ProviderId] = kept;
    }

    const { data: row, error } = await context.supabase
      .from("ai_settings")
      .update({
        default_provider: data.default_provider,
        fallback_provider: data.fallback_provider,
        model_overrides: overrides,
        updated_by: context.userId,
      })
      .eq("id", true)
      .select("default_provider, fallback_provider, model_overrides, updated_at, updated_by")
      .maybeSingle();
    if (error) throw error;
    // RLS returns zero rows, not an error, when the caller may not write.
    if (!row) throw new Error("Forbidden: ai_settings update was not permitted for this user.");

    ai.invalidateAiSettingsCache();
    return { ...row, model_overrides: (row.model_overrides ?? {}) as ModelOverrides };
  });

/**
 * One real request against a provider + model ID, before anything is saved.
 * The document task sends a 1×1 PNG along with the prompt so a text-only
 * model fails here instead of on a user's first upload.
 */
export const testAiModel = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        provider: ProviderIdSchema,
        task: TaskSchema,
        modelId: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const ai = await import("./ai-provider.server");
    const { generateText } = await import("ai");
    if (!ai.availableProviders().includes(data.provider)) {
      return {
        ok: false as const,
        ms: 0,
        error: `${ai.providerEnvKey(data.provider)} is not set in the environment.`,
      };
    }
    const started = Date.now();
    try {
      const model = ai.modelForId(data.provider, data.modelId);
      const result = await generateText({
        model,
        // Gemini 3.x thinks before it answers and that counts against this budget;
        // 16 tokens produced an empty reply on a model that was in fact healthy.
        maxOutputTokens: 256,
        messages: [
          {
            role: "user",
            content:
              data.task === "document"
                ? [
                    { type: "text", text: "Reply with the single word OK." },
                    // 1×1 transparent PNG — the smallest thing that still exercises image input.
                    {
                      type: "image",
                      image:
                        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
                      mediaType: "image/png",
                    },
                  ]
                : [{ type: "text", text: "Reply with the single word OK." }],
          },
        ],
      });
      return { ok: true as const, ms: Date.now() - started, reply: result.text.slice(0, 80) };
    } catch (err) {
      const status = (err as { statusCode?: number } | null)?.statusCode;
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false as const,
        ms: Date.now() - started,
        error: `${status ? status + " " : ""}${message.slice(0, 300)}`,
      };
    }
  });

/** Latest fallbacks and errors, newest first. RLS already limits reads to admins; the middleware is the second gate. */
// ---- LINE notifications (phase 1.3 step 4b) ----------------------------

const NotificationSettingsInput = z.object({
  line_monthly_cap: z.number().int().min(0).max(100_000),
  line_digest_reserve: z.number().int().min(0).max(100_000),
  line_digest_hour: z.number().int().min(0).max(23),
  /** true = clear the halt set by the tick after an auth failure */
  resume: z.boolean().optional(),
});

export type NotificationSettingsInput = z.infer<typeof NotificationSettingsInput>;

/** Quota state as the tick sees it, plus the settings row and a hint of the last run. */
export const getNotificationConfig = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { loadSettings, sentThisMonth } = await import("./line-deliver.server");
    const { getQuota, lineChannelToken, appOpenUrl } = await import("./line-push.server");
    const now = new Date();
    const token = lineChannelToken();
    const [settings, own, line, links, lastTick] = await Promise.all([
      loadSettings(),
      sentThisMonth(now),
      token ? getQuota(token) : Promise.resolve(null),
      context.supabase.from("line_links").select("is_friend", { count: "exact", head: true }),
      context.supabase
        .from("cron_ticks")
        .select("tick, finished_at, summary, error")
        .order("tick", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const { count: friends } = await context.supabase
      .from("line_links")
      .select("user_id", { count: "exact", head: true })
      .eq("is_friend", true);
    return {
      configured: !!token,
      settings,
      sentThisMonth: own,
      line,
      used: Math.max(own, line?.totalUsage ?? 0),
      linkedUsers: links.count ?? 0,
      friendUsers: friends ?? 0,
      openUrl: appOpenUrl("/today"),
      lastTick: lastTick.data ?? null,
    };
  });

export const updateNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => NotificationSettingsInput.parse(input))
  .handler(async ({ data, context }) => {
    if (data.line_digest_reserve > data.line_monthly_cap)
      throw new Error("reserve cannot exceed the cap");
    // Under the caller's JWT: the has_role policy on the table is the second gate.
    const { error } = await context.supabase
      .from("notification_settings")
      .update({
        line_monthly_cap: data.line_monthly_cap,
        line_digest_reserve: data.line_digest_reserve,
        line_digest_hour: data.line_digest_hour,
        updated_by: context.userId,
        ...(data.resume ? { line_halted_until: null, line_halt_reason: null } : {}),
      })
      .eq("id", true);
    if (error) throw error;
    return { ok: true as const };
  });

export const listAiEvents = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_events")
      .select("id, provider, task, status, error_code, message, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  });
