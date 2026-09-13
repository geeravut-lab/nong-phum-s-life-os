import { PROVIDER_IDS, defaultModelsFor, providerEnvKey, type ProviderId } from "./ai-provider.server";

// Live model catalogues for the admin console, so an admin picks from what
// the vendor actually serves instead of typing an ID that 404s at runtime.
//
// Endpoints checked against each vendor's API reference on 2026-09-13:
//   Google    GET https://generativelanguage.googleapis.com/v1beta/models?key=…&pageSize=1000
//             → { models: [{ name: "models/<id>", displayName, supportedGenerationMethods: [...] }], nextPageToken? }
//             ai.google.dev/api/models
//   Anthropic GET https://api.anthropic.com/v1/models?limit=1000
//             headers x-api-key, anthropic-version: 2023-06-01
//             → { data: [{ id, display_name, capabilities: { image_input: {supported}, pdf_input: {supported} } }], has_more, last_id }
//             platform.claude.com/docs/en/api/models/list
//   OpenAI    GET https://api.openai.com/v1/models
//             header Authorization: Bearer …
//             → { data: [{ id, owned_by, created }] }   (no capability data)
//             developers.openai.com/api/reference/resources/models/methods/list

export type ModelInfo = {
  id: string;
  label: string;
  /** true/false when the vendor says so; null when the list endpoint does not carry it. */
  imageInput: boolean | null;
  pdfInput: boolean | null;
};

export type ModelList = {
  provider: ProviderId;
  /** "live" = fetched from the vendor now or within the last hour; "hardcoded" = the defaults in code. */
  source: "live" | "hardcoded";
  fetchedAt: string;
  /** Present when source is "hardcoded" because the live call failed. */
  error?: string | undefined;
  models: ModelInfo[];
};

// One hour: model catalogues change on the order of weeks, and every admin
// page load would otherwise cost three vendor round-trips.
const CATALOGUE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

const cache = new Map<ProviderId, { list: ModelList; at: number }>();

function hardcoded(provider: ProviderId, error?: string): ModelList {
  const defaults = defaultModelsFor(provider);
  const ids = Array.from(new Set(Object.values(defaults)));
  return {
    provider,
    source: "hardcoded",
    fetchedAt: new Date().toISOString(),
    error,
    models: ids.map((id) => ({ id, label: id, imageInput: null, pdfInput: null })),
  };
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGoogle(key: string): Promise<ModelInfo[]> {
  type Row = { name: string; displayName?: string; supportedGenerationMethods?: string[] };
  const out: ModelInfo[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", key);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const json = (await getJson(url.toString(), {})) as { models?: Row[]; nextPageToken?: string };
    for (const m of json.models ?? []) {
      // Only chat-capable models are useful here; embeddings etc. are listed too.
      if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
      out.push({
        id: m.name.replace(/^models\//, ""),
        label: m.displayName ?? m.name,
        // The list endpoint says nothing about modalities; the Test button is the arbiter.
        imageInput: null,
        pdfInput: null,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

async function fetchAnthropic(key: string): Promise<ModelInfo[]> {
  type Row = {
    id: string;
    display_name?: string;
    capabilities?: { image_input?: { supported?: boolean }; pdf_input?: { supported?: boolean } } | null;
  };
  const out: ModelInfo[] = [];
  let afterId: string | undefined;
  do {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "1000");
    if (afterId) url.searchParams.set("after_id", afterId);
    const json = (await getJson(url.toString(), {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    })) as { data?: Row[]; has_more?: boolean; last_id?: string | null };
    for (const m of json.data ?? []) {
      out.push({
        id: m.id,
        label: m.display_name ?? m.id,
        imageInput: m.capabilities?.image_input?.supported ?? null,
        pdfInput: m.capabilities?.pdf_input?.supported ?? null,
      });
    }
    afterId = json.has_more && json.last_id ? json.last_id : undefined;
  } while (afterId);
  return out;
}

async function fetchOpenAI(key: string): Promise<ModelInfo[]> {
  type Row = { id: string };
  const json = (await getJson("https://api.openai.com/v1/models", {
    Authorization: `Bearer ${key}`,
  })) as { data?: Row[] };
  return (json.data ?? [])
    // The endpoint lists embeddings, audio, image and moderation models too,
    // with no type field. "gpt-" / "o<digit>" is the only usable filter for
    // chat models; anything it misses can still be typed by hand in the UI.
    .filter((m) => /^(gpt-|o\d)/.test(m.id) && !/embedding|tts|transcribe|whisper|realtime|moderation|image|audio/.test(m.id))
    .map((m) => ({ id: m.id, label: m.id, imageInput: null, pdfInput: null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The vendor's current model list for `provider`, cached for an hour per
 * instance. Falls back to the IDs hardcoded in ai-provider.server.ts when
 * the key is missing or the vendor call fails, and says so in `source` so
 * the admin page can show where the list came from.
 */
export async function listModels(provider: ProviderId): Promise<ModelList> {
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < CATALOGUE_TTL_MS) return hit.list;

  const key = process.env[providerEnvKey(provider)]?.trim();
  if (!key) return hardcoded(provider, `${providerEnvKey(provider)} is not set`);

  let list: ModelList;
  try {
    const models =
      provider === "google" ? await fetchGoogle(key)
      : provider === "anthropic" ? await fetchAnthropic(key)
      : await fetchOpenAI(key);
    list = { provider, source: "live", fetchedAt: new Date().toISOString(), models };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ai] listModels(${provider}) failed: ${message}`);
    list = hardcoded(provider, message);
  }
  // A failed fetch is cached too, so a vendor outage costs one call per hour, not one per page view.
  cache.set(provider, { list, at: Date.now() });
  return list;
}

export async function listAllModels(): Promise<Partial<Record<ProviderId, ModelList>>> {
  const entries = await Promise.all(
    PROVIDER_IDS.filter((id) => process.env[providerEnvKey(id)]?.trim()).map(async (id) => [id, await listModels(id)] as const),
  );
  return Object.fromEntries(entries);
}
