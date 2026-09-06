import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type ProviderId = "anthropic" | "openai" | "google";

/** Different jobs justify different model sizes: chat is frequent and cheap, documents need vision. */
export type TaskKind = "chat" | "document" | "reasoning";

type ProviderConfig = {
  envKey: string;
  models: Record<TaskKind, string>;
  supportsPdf: boolean;
  create: (apiKey: string) => (modelId: string) => LanguageModel;
};

// Model IDs below were read from each provider's official model list on 2026-09-07.
// They are not stable forever — re-check the linked pages before assuming a name still resolves.
const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  // platform.claude.com/docs/en/about-claude/models/overview
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    models: {
      chat: "claude-haiku-4-5-20251001",
      document: "claude-sonnet-5",
      reasoning: "claude-opus-5",
    },
    supportsPdf: true,
    create: (k) => createAnthropic({ apiKey: k }),
  },
  // developers.openai.com/api/docs/models
  openai: {
    envKey: "OPENAI_API_KEY",
    models: {
      chat: "gpt-5.6-luna",
      document: "gpt-5.6-terra",
      reasoning: "gpt-6-astra",
    },
    supportsPdf: true,
    create: (k) => createOpenAI({ apiKey: k }),
  },
  // ai.google.dev/gemini-api/docs/models
  google: {
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    models: {
      chat: "gemini-3.8-flash",
      document: "gemini-3.8-flash",
      reasoning: "gemini-2.5-pro",
    },
    supportsPdf: true,
    create: (k) => createGoogleGenerativeAI({ apiKey: k }),
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as string[]).includes(value);
}

function apiKeyFor(id: ProviderId): string | undefined {
  const key = process.env[PROVIDERS[id].envKey];
  return key && key.trim() !== "" ? key : undefined;
}

/** Only providers whose API key is actually present in the environment. */
export function availableProviders(): ProviderId[] {
  return PROVIDER_IDS.filter((id) => apiKeyFor(id) !== undefined);
}

export function providerSupportsPdf(id: ProviderId): boolean {
  return PROVIDERS[id].supportsPdf;
}

export function resolveProvider(): ProviderId {
  const raw = process.env["AI_PROVIDER"]?.trim();
  if (!raw) return "anthropic";
  if (!isProviderId(raw)) {
    throw new Error(
      `AI_PROVIDER="${raw}" is not a known provider. Use one of: ${PROVIDER_IDS.join(", ")}.`,
    );
  }
  return raw;
}

function resolveFallbackProvider(): ProviderId | undefined {
  const raw = process.env["AI_FALLBACK_PROVIDER"]?.trim();
  if (!raw) return undefined;
  if (!isProviderId(raw)) {
    throw new Error(
      `AI_FALLBACK_PROVIDER="${raw}" is not a known provider. Use one of: ${PROVIDER_IDS.join(", ")}, or leave it empty to disable fallback.`,
    );
  }
  return raw;
}

function modelFor(id: ProviderId, task: TaskKind): LanguageModel {
  const apiKey = apiKeyFor(id);
  if (!apiKey) {
    throw new Error(`Provider "${id}" is selected but ${PROVIDERS[id].envKey} is not set.`);
  }
  return PROVIDERS[id].create(apiKey)(PROVIDERS[id].models[task]);
}

export function getModel(task: TaskKind, override?: ProviderId): LanguageModel {
  return modelFor(override ?? resolveProvider(), task);
}

/**
 * Transient upstream failures worth spending a second provider's quota on.
 * A 4xx that is not 429 means we sent something wrong — retrying elsewhere would fail the same way.
 */
function isRetryable(error: unknown): boolean {
  const status = (error as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (error as { status?: number } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed/i.test(`${name} ${message}`);
}

/**
 * Runs `call` against the configured provider, retrying once on the fallback provider
 * when the primary fails transiently. Fallback is off unless AI_FALLBACK_PROVIDER is set.
 */
export async function withProviderFallback<T>(
  task: TaskKind,
  call: (model: LanguageModel) => Promise<T>,
): Promise<T> {
  const primary = resolveProvider();
  try {
    return await call(modelFor(primary, task));
  } catch (error) {
    const fallback = resolveFallbackProvider();
    if (!fallback || fallback === primary || !isRetryable(error)) throw error;
    if (!apiKeyFor(fallback)) {
      console.error(
        `[ai] fallback provider "${fallback}" is configured but ${PROVIDERS[fallback].envKey} is not set; rethrowing original error`,
      );
      throw error;
    }
    console.warn(
      `[ai] provider "${primary}" failed on task "${task}" (${error instanceof Error ? error.message : String(error)}); retrying once with "${fallback}"`,
    );
    return await call(modelFor(fallback, task));
  }
}

// Fail at import time rather than when a user first taps a button, so a bad
// deploy is obvious immediately.
{
  const configured = resolveProvider();
  if (!apiKeyFor(configured)) {
    const available = availableProviders();
    throw new Error(
      `AI provider "${configured}" is selected but ${PROVIDERS[configured].envKey} is not set. ` +
        (available.length > 0
          ? `Providers with keys present: ${available.join(", ")}.`
          : `No provider API keys are set at all.`),
    );
  }
  resolveFallbackProvider();
}
