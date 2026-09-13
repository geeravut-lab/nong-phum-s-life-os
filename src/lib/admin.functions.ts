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

    const available = new Set(ai.availableProviders());
    const providers = ai.PROVIDER_IDS.map((id) => ({
      id,
      hasKey: available.has(id),
      envKey: ai.providerEnvKey(id),
      defaults: ai.defaultModelsFor(id),
      capabilities: ai.providerCapabilities(id),
    }));

    const effectiveProvider = await ai.resolveProvider("config");
    const effectiveModels = Object.fromEntries(
      await Promise.all(
        ai.TASK_KINDS.map(async (task) => [task, await ai.resolveModelId(effectiveProvider, task)]),
      ),
    ) as Record<TaskKind, string>;

    return {
      settings: settings
        ? { ...settings, model_overrides: (settings.model_overrides ?? {}) as ModelOverrides }
        : null,
      providers,
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
      const kept = Object.fromEntries(Object.entries(tasks ?? {}).filter(([, v]) => v && v.trim() !== ""));
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
