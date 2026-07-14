/**
 * llm/provider.mjs — the single LLM seam (atomic service).
 *
 * Every `skills.*` atom and `nodes.llm`/`nodes.agent` reaches models ONLY
 * through this interface — never a provider SDK directly. Three modes:
 *
 *   mock       (default) deterministic FNV-1a-keyed stub. No network, no key.
 *              Schema-constrained calls return a minimal schema-valid object.
 *              This is the acceptance contract for tests and offline runs —
 *              the same convention (`MOCK=1` / `DRY_RUN=1`) used across the
 *              projects/ corpus.
 *   anthropic  raw fetch to the Anthropic Messages API (ANTHROPIC_API_KEY).
 *   openai     raw fetch to any OpenAI-compatible /chat/completions endpoint
 *              (LANGGRAPH_LANGCHAIN_HARNESS_LLM_BASE_URL + LANGGRAPH_LANGCHAIN_HARNESS_LLM_API_KEY) — covers local runtimes.
 *
 * Structured output: when `schema` is passed, real modes append a strict
 * JSON instruction and parse the reply; the mock mode synthesizes a
 * schema-valid skeleton. Parsing/validation failures are reported via
 * `structured: undefined` + `parse_error` so the node's validate-gate policy
 * (raise | degrade | route) decides what happens — the provider never guesses.
 */

import { skeletonFromSchema } from "../schema/mini-json-schema.mjs";

/** FNV-1a 32-bit — the corpus-canonical deterministic hash. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function extractJson(text) {
  // strip markdown fences, then take the outermost {...} or [...] slice
  const unfenced = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
  const start = unfenced.search(/[{[]/);
  if (start === -1) return null;
  for (let end = unfenced.length; end > start; end--) {
    const candidate = unfenced.slice(start, end);
    try {
      return JSON.parse(candidate);
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}

class MockProvider {
  constructor({ model = "mock-model" } = {}) {
    this.mode = "mock";
    this.model = model;
  }
  async invoke({ system = "", user = "", schema = null, model }) {
    const key = fnv1a(`${system}\n${user}`).toString(16).padStart(8, "0");
    if (schema) {
      const structured = skeletonFromSchema(schema, `mock-${key}`);
      return { content: JSON.stringify(structured), structured, model: model ?? this.model, mode: "mock", key };
    }
    const content = `[mock:${key}] deterministic response for: ${user.slice(0, 120).replace(/\s+/g, " ")}`;
    return { content, model: model ?? this.model, mode: "mock", key };
  }
  async shutdown() {}
}

const JSON_INSTRUCTION = (schema) =>
  `\n\nRespond with ONLY a JSON value that conforms to this JSON Schema (no prose, no markdown fences):\n${JSON.stringify(schema)}`;

class AnthropicProvider {
  constructor({ model = "claude-sonnet-4-5", apiKey, baseUrl = "https://api.anthropic.com", maxTokens = 2048 }) {
    this.mode = "anthropic";
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.maxTokens = maxTokens;
  }
  async invoke({ system = "", user = "", schema = null, model, temperature }) {
    const body = {
      model: model ?? this.model,
      max_tokens: this.maxTokens,
      system: system || undefined,
      messages: [{ role: "user", content: schema ? user + JSON_INSTRUCTION(schema) : user }],
      temperature,
    };
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`anthropic API error ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = (data.content ?? []).map((b) => b.text ?? "").join("");
    const out = { content, model: data.model, mode: "anthropic", usage: data.usage };
    if (schema) {
      const structured = extractJson(content);
      out.structured = structured ?? undefined;
      if (structured == null) out.parse_error = "model reply was not parseable JSON";
    }
    return out;
  }
  async shutdown() {}
}

class OpenAICompatibleProvider {
  constructor({ model = "gpt-4o-mini", apiKey = "", baseUrl, maxTokens = 2048 }) {
    this.mode = "openai";
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.maxTokens = maxTokens;
  }
  async invoke({ system = "", user = "", schema = null, model, temperature }) {
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: schema ? user + JSON_INSTRUCTION(schema) : user });
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: model ?? this.model, messages, max_tokens: this.maxTokens, temperature }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`llm endpoint error ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const out = { content, model: data.model, mode: "openai", usage: data.usage };
    if (schema) {
      const structured = extractJson(content);
      out.structured = structured ?? undefined;
      if (structured == null) out.parse_error = "model reply was not parseable JSON";
    }
    return out;
  }
  async shutdown() {}
}

/**
 * Providers this factory cannot build itself: they are SDK-backed and are
 * resolved by the harness integration pack, which injects them into
 * `compileFlow({options: {llm}})`. Named here only so a BARE cli run reports
 * the truth ("requires the harness integration pack") instead of implying a
 * credential problem.
 */
export const PACK_RESOLVED_PROVIDERS = ["claude-sdk", "github-sdk"];

/** Every provider name the seam recognizes. */
export const LLM_PROVIDERS = ["mock", "anthropic", "openai", ...PACK_RESOLVED_PROVIDERS];

/**
 * Build the provider for a run.
 *
 * Selection: explicit `mock` always wins → MockProvider. Otherwise
 * LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER (anthropic | openai | claude-sdk |
 * github-sdk | mock) with graceful fallback to mock when the required key/url is
 * missing (a warning is logged once by the caller via the returned
 * `fallback_reason`).
 *
 * The two SDK-backed names are never CONSTRUCTED here — a caller that wants them
 * injects the provider (`compileFlow({options: {llm}})`); reaching this factory
 * with one of them means no such caller was in the loop.
 */
export function createLlmProvider({ mock = true, model, env = process.env } = {}) {
  if (mock) return new MockProvider({ model });
  const requested = (env.LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER ?? "").toLowerCase();
  if (requested === "anthropic" && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider({ model: model ?? env.LANGGRAPH_LANGCHAIN_HARNESS_LLM_MODEL, apiKey: env.ANTHROPIC_API_KEY });
  }
  if (requested === "openai" && env.LANGGRAPH_LANGCHAIN_HARNESS_LLM_BASE_URL) {
    return new OpenAICompatibleProvider({
      model: model ?? env.LANGGRAPH_LANGCHAIN_HARNESS_LLM_MODEL,
      apiKey: env.LANGGRAPH_LANGCHAIN_HARNESS_LLM_API_KEY ?? "",
      baseUrl: env.LANGGRAPH_LANGCHAIN_HARNESS_LLM_BASE_URL,
    });
  }
  const provider = new MockProvider({ model });
  if (requested === "") {
    provider.fallback_reason = "no LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER configured — using mock";
  } else if (PACK_RESOLVED_PROVIDERS.includes(requested)) {
    // Not a credential problem: this provider is built by the integration pack
    // and injected. Say so, so nobody goes hunting for a missing key.
    provider.fallback_reason = `provider '${requested}' requires the harness integration pack (no injected provider) — using mock`;
  } else {
    provider.fallback_reason = `provider '${requested}' missing credentials (ANTHROPIC_API_KEY / LANGGRAPH_LANGCHAIN_HARNESS_LLM_BASE_URL) — using mock`;
  }
  return provider;
}
