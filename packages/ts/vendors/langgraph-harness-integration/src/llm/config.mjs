/**
 * src/llm/config.mjs — the LLM toggle (change record 0062/D3).
 *
 * ONE dial, one precedence chain, mirroring the chain both vendored SDKs already
 * implement themselves:
 *
 *   defaults  <  harness.config.json  <  environment  <  flow param
 *
 *   1. defaults        → provider `mock`. No key, no network, no SDK loaded.
 *   2. config file     → harness-repo-package-remediation/harness.config.json (gitignored; the committed
 *                        harness.config.example.json is the template). Override
 *                        the location with HARNESS_CONFIG_FILE.
 *   3. environment     → LANGGRAPH_LANGCHAIN_HARNESS_LLM_* (the same namespace the
 *                        vendored platform's own seam reads).
 *   4. flow param      → `with: { model: … }` on the node still outranks everything
 *                        for the model id; that rung lives in the atom, not here.
 *
 * Credentials are NOT part of this config: each SDK reads its own from the
 * environment at the seam (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / …), so they
 * never enter flow yaml, state channels, events, logs, or commits (security rule 5).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Providers built by the vendored platform's own seam (raw fetch / deterministic stub). */
export const PLATFORM_PROVIDERS = ["mock", "anthropic", "openai"];

/** Providers built HERE, from a vendored SDK, and injected into the compiler. */
export const SDK_PROVIDERS = ["claude-sdk", "github-sdk"];

/** The full recognized vocabulary (record 0062/A2). */
export const LLM_PROVIDERS = [...PLATFORM_PROVIDERS, ...SDK_PROVIDERS];

/** True when `provider` is one this pack must construct and inject. */
export function isSdkProvider(provider) {
  return SDK_PROVIDERS.includes(provider);
}

/** Raised when the resolved LLM configuration is not usable. Never swallowed. */
export class LlmConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "LlmConfigError";
  }
}

/**
 * The floor. `model: null` means "whatever the selected SDK defaults to", which
 * differs per provider (claude-opus-4-8 / gpt-5-mini) — pinning one here would
 * hand a Claude model id to Copilot the moment the toggle flips.
 *
 * `maxTokens`, `temperature`, `maxRetries` and `timeout` exist BECAUSE they were
 * unreachable constants on the legacy lane (record 0062/A3): a truncated reply
 * used to present as "the model had nothing useful to say".
 */
export function defaultLlmConfig() {
  return {
    provider: "mock",
    model: null,
    maxTokens: 16_000,
    temperature: 0,
    reasoningEffort: null,
    maxRetries: 3,
    timeout: 60_000,
    tokenBudget: null,
    allowMockFallback: false,
  };
}

/** harness-repo-package-remediation/ — the root that holds harness.config.json (this file lives at vendors/<pack>/src/llm/). */
export function harnessConfigDir() {
  return fileURLToPath(new URL("../../../../", import.meta.url));
}

/** Absolute path of the config file this run would read (whether or not it exists). */
export function harnessConfigPath(env = process.env) {
  return env.HARNESS_CONFIG_FILE ? env.HARNESS_CONFIG_FILE : `${harnessConfigDir()}harness.config.json`;
}

/** Read `{llm: {…}}` out of harness.config.json. A missing file is not an error; a malformed one is. */
export function readConfigFileLayer(env = process.env) {
  const file = harnessConfigPath(env);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new LlmConfigError(`cannot read ${file}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LlmConfigError(`${file} is not valid JSON: ${err.message}`);
  }
  return parsed?.llm && typeof parsed.llm === "object" ? parsed.llm : {};
}

function num(value, key) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new LlmConfigError(`${key} must be a number (got "${value}")`);
  return n;
}

/** Map the recognized environment variables onto a config layer. */
export function envLayer(env = process.env) {
  const layer = {};
  const e = env;
  if (e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER) layer.provider = e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER.toLowerCase();
  if (e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_MODEL) layer.model = e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_MODEL;
  if (e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_MAX_TOKENS) layer.maxTokens = num(e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_MAX_TOKENS, "LANGGRAPH_LANGCHAIN_HARNESS_LLM_MAX_TOKENS");
  if (e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_TEMPERATURE) layer.temperature = num(e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_TEMPERATURE, "LANGGRAPH_LANGCHAIN_HARNESS_LLM_TEMPERATURE");
  if (e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_REASONING_EFFORT) layer.reasoningEffort = e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_REASONING_EFFORT;
  if (e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_MAX_RETRIES) layer.maxRetries = num(e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_MAX_RETRIES, "LANGGRAPH_LANGCHAIN_HARNESS_LLM_MAX_RETRIES");
  if (e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_TIMEOUT_MS) layer.timeout = num(e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_TIMEOUT_MS, "LANGGRAPH_LANGCHAIN_HARNESS_LLM_TIMEOUT_MS");
  if (e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_TOKEN_BUDGET) {
    layer.tokenBudget = { maxTokens: num(e.LANGGRAPH_LANGCHAIN_HARNESS_LLM_TOKEN_BUDGET, "LANGGRAPH_LANGCHAIN_HARNESS_LLM_TOKEN_BUDGET"), enforcement: "warn" };
  }
  if (e.HARNESS_ALLOW_MOCK_FALLBACK === "1") layer.allowMockFallback = true;
  return layer;
}

/**
 * Resolve the run's LLM configuration through the full chain.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {object} [opts.overrides] programmatic layer (tests; the wizard's own choice)
 * @returns {{provider: string, model: string|null, maxTokens: number, temperature: number,
 *   reasoningEffort: string|null, maxRetries: number, timeout: number,
 *   tokenBudget: object|null, allowMockFallback: boolean, configFile: string}}
 */
export function resolveLlmConfig({ env = process.env, overrides = {} } = {}) {
  const resolved = { ...defaultLlmConfig(), ...readConfigFileLayer(env), ...envLayer(env), ...overrides };
  resolved.configFile = harnessConfigPath(env);
  if (!LLM_PROVIDERS.includes(resolved.provider)) {
    throw new LlmConfigError(
      `unknown LLM provider '${resolved.provider}' — expected one of ${LLM_PROVIDERS.join(", ")}`,
    );
  }
  return resolved;
}
