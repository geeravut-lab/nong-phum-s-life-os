import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ProviderId = "anthropic" | "openai" | "google";

/** Different jobs justify different model sizes: chat is frequent and cheap, documents need vision. */
export type TaskKind = "chat" | "document" | "reasoning";

/**
 * What a provider can take as input on an ordinary chat call. Checked against
 * each vendor's docs on 2026-09-12: only Gemini accepts audio inline; Anthropic
 * lists text and image only, and OpenAI's audio goes through a separate
 * transcription endpoint rather than the chat model.
 */
export type ProviderCapabilities = { pdf: boolean; audio: boolean };

type ProviderConfig = {
  envKey: string;
  models: Record<TaskKind, string>;
  capabilities: ProviderCapabilities;
  create: (apiKey: string) => (modelId: string) => LanguageModel;
};

// Model IDs below were read from each provider's official model list on 2026-09-07.
// They are not stable forever — re-check the linked pages before assuming a name still resolves.
// An admin can override any of them per task from ai_settings.model_overrides.
const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  // platform.claude.com/docs/en/about-claude/models/overview
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    models: {
      chat: "claude-haiku-4-5-20251001",
      document: "claude-sonnet-5",
      reasoning: "claude-opus-5",
    },
    capabilities: { pdf: true, audio: false },
    create: (k) => createAnthropic({ apiKey: k }),
  },
  // developers.openai.com/api/docs/models
  // UNTESTED: no OPENAI_API_KEY has ever been set on this project, so no request
  // has been made against these IDs. Re-check the model list and run a real call
  // before turning this provider on.
  openai: {
    envKey: "OPENAI_API_KEY",
    models: {
      chat: "gpt-5.6-luna",
      document: "gpt-5.6-terra",
      reasoning: "gpt-6-astra",
    },
    capabilities: { pdf: true, audio: false },
    create: (k) => createOpenAI({ apiKey: k }),
  },
  // ai.google.dev/gemini-api/docs/models — but the docs page and the live API
  // disagree, and the API wins. Probed against our own key on 2026-09-08:
  //   gemini-3.8-flash      429 quota exceeded, and ~28s when it did answer
  //   gemini-3.6-flash      worked, but one run took 28s and the next 1.6s
  //   gemini-3.7-flash      ~1.5s, consistent across every run
  //   gemini-2.5-pro        404 "no longer available to new users"
  //   every Pro model       429 — the Pro tier has no free-tier quota at all
  // So 3.7 is not a downgrade here, it is the newest Flash our plan actually
  // serves reliably. reasoning points at it too rather than a Pro model that
  // 429s on this key; move reasoning to a Pro id once the account is on a paid
  // plan (the API suggests gemini-3.1-pro-preview as 2.5-pro's replacement).
  google: {
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    models: {
      chat: "gemini-3.7-flash",
      document: "gemini-3.7-flash",
      reasoning: "gemini-3.7-flash",
    },
    capabilities: { pdf: true, audio: true },
    create: (k) => createGoogleGenerativeAI({ apiKey: k }),
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export const TASK_KINDS: TaskKind[] = ["chat", "document", "reasoning"];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as string[]).includes(value);
}

function apiKeyFor(id: ProviderId): string | undefined {
  const key = process.env[PROVIDERS[id].envKey];
  return key && key.trim() !== "" ? key : undefined;
}

/** Only providers whose API key is actually present in the environment. */
export function availableProviders(): ProviderId[] {
  return PROVIDER_IDS.filter((id) => apiKeyFor(id) !== undefined);
}

export function providerEnvKey(id: ProviderId): string {
  return PROVIDERS[id].envKey;
}

export function providerCapabilities(id: ProviderId): ProviderCapabilities {
  return PROVIDERS[id].capabilities;
}

/** The model IDs baked into this build, before any admin override. */
export function defaultModelsFor(id: ProviderId): Record<TaskKind, string> {
  return { ...PROVIDERS[id].models };
}

// ---------------------------------------------------------------------------
// ai_settings: the admin-editable layer that sits above the environment.
// ---------------------------------------------------------------------------

export type ModelOverrides = Partial<Record<ProviderId, Partial<Record<TaskKind, string>>>>;

export type AiSettingsRow = {
  default_provider: string | null;
  fallback_provider: string | null;
  model_overrides: ModelOverrides;
  updated_at: string;
  updated_by: string | null;
};

// 30 seconds is the deal made with the admin UI ("changes apply within a
// minute"). Each Netlify Functions instance keeps its own copy, so a longer
// TTL would let two instances disagree for longer; a shorter one would put a
// DB read in front of nearly every AI call. There is no cross-instance
// invalidation — the TTL is the only guarantee of convergence.
const SETTINGS_TTL_MS = 30_000;

let settingsCache: { row: AiSettingsRow | null; fetchedAt: number } | undefined;

/**
 * Current ai_settings row, cached per instance for SETTINGS_TTL_MS.
 *
 * Read with the service-role client because three of the five AI call sites
 * (document analysis, job drafting, skill drafting) have no user-scoped
 * Supabase client in hand. The table's own RLS still governs every write.
 * If the read fails, the previous value is kept (or null, which means "use
 * the environment") rather than taking the AI feature down with the DB.
 */
export async function getAiSettings(): Promise<AiSettingsRow | null> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.fetchedAt < SETTINGS_TTL_MS) {
    return settingsCache.row;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_settings")
      .select("default_provider, fallback_provider, model_overrides, updated_at, updated_by")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    settingsCache = {
      row: data ? { ...data, model_overrides: (data.model_overrides ?? {}) as ModelOverrides } : null,
      fetchedAt: now,
    };
  } catch (err) {
    console.error(
      `[ai] could not read ai_settings (${err instanceof Error ? err.message : String(err)}); ` +
        (settingsCache ? "keeping the previous value" : "falling back to the environment"),
    );
    settingsCache = { row: settingsCache?.row ?? null, fetchedAt: now };
  }
  return settingsCache.row;
}

/** Called after an admin save so the instance that handled it sees the change at once. */
export function invalidateAiSettingsCache(): void {
  settingsCache = undefined;
}

// ---------------------------------------------------------------------------
// ai_events: fallbacks and errors only, never successful calls.
// ---------------------------------------------------------------------------

export type AiEvent = {
  provider: ProviderId | string;
  task: TaskKind | "config";
  status: "fallback" | "error";
  error_code?: string | null;
  message?: string | null;
};

/** Best-effort. A logging failure must never mask the error being logged. */
export async function logAiEvent(event: AiEvent): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("ai_events").insert({
      provider: event.provider,
      task: event.task,
      status: event.status,
      error_code: event.error_code ?? null,
      message: event.message?.slice(0, 1000) ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error("[ai] could not write ai_events", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Resolution order: ai_settings (DB) → environment → default in code.
// ---------------------------------------------------------------------------

function resolveProviderFromEnv(): ProviderId {
  const raw = process.env["AI_PROVIDER"]?.trim();
  if (!raw) return "anthropic";
  if (!isProviderId(raw)) {
    throw new Error(
      `AI_PROVIDER="${raw}" is not a known provider. Use one of: ${PROVIDER_IDS.join(", ")}.`,
    );
  }
  return raw;
}

function resolveFallbackFromEnv(): ProviderId | undefined {
  const raw = process.env["AI_FALLBACK_PROVIDER"]?.trim();
  if (!raw) return undefined;
  if (!isProviderId(raw)) {
    throw new Error(
      `AI_FALLBACK_PROVIDER="${raw}" is not a known provider. Use one of: ${PROVIDER_IDS.join(", ")}, or leave it empty to disable fallback.`,
    );
  }
  return raw;
}

// The runtime guard below can fire on every AI call while a bad setting is in
// place; one ai_events row per cache window is enough to make it visible.
let lastGuardLogAt = 0;

/**
 * The provider that should handle `task` right now.
 *
 * Runtime guard: the admin UI refuses to save a provider whose key is missing,
 * but the key can be removed from the environment after the fact. In that case
 * fall back to the environment's provider and record an ai_events row, rather
 * than failing the user's request over a configuration problem.
 */
export async function resolveProvider(task: TaskKind | "config" = "config"): Promise<ProviderId> {
  const settings = await getAiSettings();
  const fromDb = settings?.default_provider;
  if (isProviderId(fromDb)) {
    if (apiKeyFor(fromDb)) return fromDb;
    const envProvider = resolveProviderFromEnv();
    const now = Date.now();
    if (now - lastGuardLogAt > SETTINGS_TTL_MS) {
      lastGuardLogAt = now;
      const message = `ai_settings.default_provider is "${fromDb}" but ${PROVIDERS[fromDb].envKey} is not set; using "${envProvider}" from the environment instead`;
      console.error(`[ai] ${message}`);
      await logAiEvent({ provider: fromDb, task, status: "error", error_code: "missing_api_key", message });
    }
    return envProvider;
  }
  return resolveProviderFromEnv();
}

async function resolveFallbackProvider(): Promise<ProviderId | undefined> {
  const settings = await getAiSettings();
  const fromDb = settings?.fallback_provider;
  if (fromDb === "none") return undefined;
  if (isProviderId(fromDb)) return fromDb;
  return resolveFallbackFromEnv();
}

/** The model ID `id` will use for `task`: admin override first, then the default in code. */
export async function resolveModelId(id: ProviderId, task: TaskKind): Promise<string> {
  const settings = await getAiSettings();
  const override = settings?.model_overrides?.[id]?.[task];
  return typeof override === "string" && override.trim() !== "" ? override.trim() : PROVIDERS[id].models[task];
}

async function modelFor(id: ProviderId, task: TaskKind): Promise<LanguageModel> {
  const apiKey = apiKeyFor(id);
  if (!apiKey) {
    throw new Error(`Provider "${id}" is selected but ${PROVIDERS[id].envKey} is not set.`);
  }
  return PROVIDERS[id].create(apiKey)(await resolveModelId(id, task));
}

export async function getModel(task: TaskKind, override?: ProviderId): Promise<LanguageModel> {
  return modelFor(override ?? (await resolveProvider(task)), task);
}

/**
 * Whether a failure is worth spending the fallback provider's quota on.
 *
 * 429/5xx/network are transient. 401/403 are included too: they mean the primary's
 * key is dead or revoked, which is precisely when a second provider keeps the app
 * usable — and every switch is logged, so a broken key still surfaces rather than
 * hiding. Other 4xx (400, 404, 422) mean our own request or model name is wrong,
 * and would fail identically on the fallback, so they are not worth a second call.
 */
function shouldTryFallback(error: unknown): boolean {
  const status = (error as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (error as { status?: number } | null)?.status;
  if (typeof status === "number") {
    return status === 429 || status === 401 || status === 403 || status >= 500;
  }
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed/i.test(`${name} ${message}`);
}

function errorCodeOf(error: unknown): string | null {
  const status = (error as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (error as { status?: number } | null)?.status;
  if (typeof status === "number") return String(status);
  const name = (error as { name?: string } | null)?.name;
  return name && name !== "Error" ? name : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `call` against the configured provider, retrying once on the fallback provider
 * when the primary fails transiently. Fallback is off unless configured in
 * ai_settings or AI_FALLBACK_PROVIDER. Every fallback and every final failure
 * is recorded in ai_events.
 */
export async function withProviderFallback<T>(
  task: TaskKind,
  call: (model: LanguageModel) => Promise<T>,
): Promise<T> {
  const primary = await resolveProvider(task);
  try {
    return await call(await modelFor(primary, task));
  } catch (error) {
    const fallback = await resolveFallbackProvider();
    if (!fallback || fallback === primary || !shouldTryFallback(error)) {
      await logAiEvent({ provider: primary, task, status: "error", error_code: errorCodeOf(error), message: messageOf(error) });
      throw error;
    }
    if (!apiKeyFor(fallback)) {
      const note = `fallback provider "${fallback}" is configured but ${PROVIDERS[fallback].envKey} is not set; rethrowing original error`;
      console.error(`[ai] ${note}`);
      await logAiEvent({ provider: primary, task, status: "error", error_code: errorCodeOf(error), message: `${messageOf(error)} (${note})` });
      throw error;
    }
    console.warn(
      `[ai] provider "${primary}" failed on task "${task}" (${messageOf(error)}); retrying once with "${fallback}"`,
    );
    await logAiEvent({ provider: primary, task, status: "fallback", error_code: errorCodeOf(error), message: `${messageOf(error)} → retried on "${fallback}"` });
    try {
      return await call(await modelFor(fallback, task));
    } catch (fallbackError) {
      await logAiEvent({ provider: fallback, task, status: "error", error_code: errorCodeOf(fallbackError), message: `fallback also failed: ${messageOf(fallbackError)}` });
      throw fallbackError;
    }
  }
}

/**
 * Throws unless the environment on its own is usable: the env-selected provider
 * has a key, and any env-selected fallback names a real provider.
 *
 * Called from src/server.ts so a misconfigured deploy dies at startup instead of
 * when a user first taps a button. It cannot be a bare module-side-effect: this
 * module is only pulled in lazily by the server functions, and package.json
 * declares "sideEffects": false, so an import-for-effect could be dropped.
 *
 * This checks the environment only. ai_settings can point somewhere else at
 * runtime; that path is validated when an admin saves and again by the guard in
 * resolveProvider(), not here — a passing boot does not mean the DB value is good.
 */
export function assertAiProviderConfig(): void {
  const configured = resolveProviderFromEnv();
  if (!apiKeyFor(configured)) {
    const available = availableProviders();
    throw new Error(
      `AI provider "${configured}" is selected but ${PROVIDERS[configured].envKey} is not set. ` +
        (available.length > 0
          ? `Providers with keys present: ${available.join(", ")}.`
          : `No provider API keys are set at all.`),
    );
  }
  resolveFallbackFromEnv();
}
