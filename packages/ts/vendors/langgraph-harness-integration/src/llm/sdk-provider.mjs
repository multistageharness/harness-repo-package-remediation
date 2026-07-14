/**
 * src/llm/sdk-provider.mjs — the SDK-backed LLM provider (change record 0062/D2+D4).
 *
 * ONE adapter serves BOTH vendored SDKs, because both expose the same surface
 * (`createHarness({config}, deps)` → `chat()` / `structured()` / `usageSummary()` /
 * `stop()`). It implements the platform's seam contract exactly —
 *
 *   ctx.llm.invoke({system, user, schema, model, temperature})
 *     → {content, structured?, parse_error?, model, mode, usage?}
 *
 * — so every existing atom keeps working with no change, and `mode` becomes
 * `"claude-sdk"` / `"github-sdk"` instead of `"mock"`, which is exactly what the
 * `result.mode === "mock"` guards at the two live call sites test for.
 *
 * TWO CONTRACTS THAT MUST NOT BEND:
 *
 *   1. `invoke` NEVER THROWS on a bad reply. The SDK's structured() throws once its
 *      repair loop is exhausted; a transport failure throws once retries are spent.
 *      Both are caught here and returned as `{parse_error}` — the recorded-degrade
 *      shape both call sites already handle (detect-setup.mjs, optimize-prompt.mjs
 *      keep their deterministic fallback and log a `minor` finding). Letting either
 *      escape would convert a recorded degrade into a crashed 12-repo run.
 *
 *   2. Each `invoke` is an ISOLATED TURN. Both harnesses keep a session with a
 *      growing message array; reusing it across repos would leak repo #1's excerpts
 *      into repo #7's prompt (and bill for it). A fresh session is created per call.
 *
 * The SDKs are reached by RELATIVE dynamic import through the symlinks at
 * harness-repo-package-remediation/vendors/{claude-sdk,github-sdk} — never a bare specifier, never a
 * declared dependency (record 0062/D6): their install roots (and the caret range
 * `@anthropic-ai/sdk` carries) stay out of the harness lockfile. A dangling symlink
 * on a fresh clone is therefore a normal, caught condition — reported by D4, not a
 * module-resolution crash at load time.
 */

// 0052/D1 — the tracing chokepoint. This side-effect import MUST stay first: it
// throws the LangSmith switches off before anything else in this module can reach
// a model. A provider that opened egress behind the seam is exactly what 0052 closed.
import "../tracing-init.mjs";

import { isSdkProvider, resolveLlmConfig, SDK_PROVIDERS } from "./config.mjs";

/** Raised when a REQUESTED SDK provider cannot be constructed. Aborts the run (D4). */
export class LlmProviderError extends Error {
  constructor(message, { provider, cause } = {}) {
    super(message);
    this.name = "LlmProviderError";
    this.provider = provider;
    this.cause = cause;
  }
}

/** Per-provider wiring: where the symlink points, and what it needs to talk to a model. */
const SDK_SPECS = {
  "claude-sdk": {
    dir: "claude-sdk",
    pkg: "llm-sdk-anthropic",
    // The Anthropic client needs one of these at the seam; env-only, never in config.
    credentials: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
    // The Messages API takes temperature as a request param (the SDK's documented
    // passthrough); Copilot's session API has no such knob.
    supportsTemperature: true,
  },
  "github-sdk": {
    dir: "github-sdk",
    pkg: "llm-sdk-github-copilot",
    // The Copilot SDK resolves its own auth (gh CLI / runtime); nothing to assert here.
    credentials: [],
    supportsTemperature: false,
  },
};

/** The module URL a provider resolves to — the vendored symlink, by relative path. */
export function sdkModuleUrl(provider) {
  const spec = SDK_SPECS[provider];
  if (!spec) throw new LlmProviderError(`'${provider}' is not an SDK-backed provider`, { provider });
  return new URL(`../../../${spec.dir}/src/index.mjs`, import.meta.url);
}

/**
 * Import a vendored SDK. A dangling symlink (the fresh-clone case — the SDKs are
 * symlinks to a sibling checkout, not subtree mirrors) surfaces HERE, named, with
 * the fix, instead of as an opaque ERR_MODULE_NOT_FOUND.
 *
 * @param {string} provider "claude-sdk" | "github-sdk"
 * @param {{importer?: (spec: string) => Promise<object>}} [deps] test seam
 */
export async function loadSdkModule(provider, { importer } = {}) {
  const spec = SDK_SPECS[provider];
  const url = sdkModuleUrl(provider);
  const load = importer ?? ((s) => import(s));
  try {
    return await load(url.href);
  } catch (err) {
    throw new LlmProviderError(
      `LLM provider '${provider}' is unavailable: cannot load ${spec.pkg} from harness-repo-package-remediation/vendors/${spec.dir}.\n` +
        `  harness-repo-package-remediation/vendors/${spec.dir} is a SYMLINK to a sibling checkout — it does not resolve here.\n` +
        `  Fix: check out the SDK beside this repo and run its own 'npm install', or select another provider ` +
        `(LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=mock).\n  cause: ${err.message}`,
      { provider, cause: err },
    );
  }
}

/**
 * The adapter. Wraps one started harness; every `invoke` is one isolated turn.
 */
export class HarnessSdkProvider {
  /**
   * @param {object} harness a started ClaudeHarness / CopilotHarness
   * @param {{provider: string, model?: string|null, maxTokens?: number|null, temperature?: number|null}} opts
   */
  constructor(harness, { provider, model = null, maxTokens = null, temperature = null }) {
    this.harness = harness;
    this.mode = provider;
    this.model = model ?? harness.config?.model ?? null;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.supportsTemperature = SDK_SPECS[provider]?.supportsTemperature === true;
  }

  /** Per-call options both SDKs understand (`systemPrompt`/`model` are honored by each). */
  _callOptions({ system, model }) {
    const opts = {};
    if (system) opts.systemPrompt = system;
    const resolvedModel = model ?? this.model;
    if (resolvedModel) opts.model = resolvedModel;
    if (this.maxTokens != null) opts.maxTokens = this.maxTokens;
    return opts;
  }

  /**
   * Temperature is not a per-call option on either harness — it rides the SDK's
   * documented `requestDefaults` passthrough, which is merged into every request.
   * Copilot's session API has no temperature, so this is a no-op there.
   */
  _applyTemperature(temperature) {
    if (!this.supportsTemperature) return;
    const value = temperature ?? this.temperature;
    if (value == null) return;
    this.harness.config.requestDefaults = { ...this.harness.config.requestDefaults, temperature: value };
  }

  /**
   * The seam. Returns the platform's reply shape; never throws for a model-side or
   * transport-side failure — those come back as `parse_error` so the calling atom
   * runs its own degrade policy.
   */
  async invoke({ system = "", user = "", schema = null, model, temperature } = {}) {
    const opts = this._callOptions({ system, model });
    const reply = { model: opts.model ?? this.model, mode: this.mode };
    try {
      this._applyTemperature(temperature);
      // Isolated turn: drop the prior conversation before every call.
      await this.harness.createSession(opts);

      if (schema) {
        const { value, content, usage } = await this.harness.structured(user, schema, opts);
        return { ...reply, content: content ?? JSON.stringify(value), structured: value, usage };
      }
      const { content, usage } = await this.harness.chat(user, opts);
      return { ...reply, content: content ?? "", usage };
    } catch (err) {
      // Structured-repair exhausted, budget refusal, or a transport failure the SDK
      // already retried — all of them degrade, none of them kill the run.
      return {
        ...reply,
        content: "",
        structured: undefined,
        parse_error: `${this.mode} call failed: ${err.message}`,
      };
    }
  }

  /** Aggregate token/cost accounting for the whole run (tokens, tools, models, latency, budget). */
  usageSummary() {
    return this.harness.usageSummary?.() ?? null;
  }

  async shutdown() {
    await this.harness.stop?.();
  }
}

/**
 * Construct the SDK-backed provider for `provider`. Throws `LlmProviderError` when
 * it cannot be built — a missing credential is NOT allowed to silently become a
 * mock run (D4).
 *
 * @param {object} opts
 * @param {string} opts.provider "claude-sdk" | "github-sdk"
 * @param {object} opts.config the resolved LLM config (src/llm/config.mjs)
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {object} [opts.deps] test seams: {importer, clientFactory}
 */
export async function createSdkProvider({ provider, config, env = process.env, deps = {} }) {
  if (!isSdkProvider(provider)) {
    throw new LlmProviderError(`'${provider}' is not one of ${SDK_PROVIDERS.join(", ")}`, { provider });
  }
  const spec = SDK_SPECS[provider];

  // A credential check the SDK would otherwise fail on mid-run, on repo #7 of 12.
  // The Copilot SDK resolves its own auth, so it declares none and is not gated.
  if (spec.credentials.length > 0 && !spec.credentials.some((name) => env[name]) && !deps.clientFactory) {
    throw new LlmProviderError(
      `LLM provider '${provider}' has no credential: set one of ${spec.credentials.join(" / ")} in the environment, ` +
        `or select another provider (LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=mock).`,
      { provider },
    );
  }

  const mod = await loadSdkModule(provider, deps);
  const sdkConfig = {
    ...(config.model ? { model: config.model } : {}),
    ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
    ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
    ...(config.maxRetries != null ? { maxRetries: config.maxRetries } : {}),
    ...(config.timeout != null ? { timeout: config.timeout, requestTimeoutMs: config.timeout } : {}),
    ...(config.tokenBudget ? { tokenBudget: config.tokenBudget } : {}),
    // The atom supplies the whole system prompt per call, so it REPLACES rather than
    // appends to whatever a config file left behind.
    systemPromptMode: "replace",
    ...(spec.supportsTemperature && config.temperature != null
      ? { requestDefaults: { temperature: config.temperature } }
      : {}),
  };

  let harness;
  try {
    harness = await mod.createHarness({ config: sdkConfig }, { env, ...(deps.clientFactory ? { clientFactory: deps.clientFactory } : {}) });
  } catch (err) {
    throw new LlmProviderError(`LLM provider '${provider}' failed to start: ${err.message}`, { provider, cause: err });
  }

  return new HarnessSdkProvider(harness, {
    provider,
    model: config.model ?? harness.config?.model ?? null,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  });
}

/**
 * The one entry point the run leg calls (`src/run-flow.mjs`).
 *
 * Returns the provider to INJECT into `compileFlow({options: {llm}})`, or `null`
 * when the platform's own seam should build it (mock / anthropic / openai) — so
 * the legacy lane is untouched and a mock run never loads an SDK at all.
 *
 * D4 — fail loud, not mock: when an SDK provider is REQUESTED and cannot be built,
 * this throws. `HARNESS_ALLOW_MOCK_FALLBACK=1` (or `allowMockFallback` in the config
 * file) restores the old soft behavior for anyone who wants it, and says so.
 *
 * @param {object} opts
 * @param {boolean} [opts.mock] the run's mock switch — always wins
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {object} [opts.overrides] programmatic config layer
 * @param {object} [opts.deps] test seams: {importer, clientFactory}
 * @param {(message: string) => void} [opts.onWarn]
 * @returns {Promise<{provider: object|null, config: object}>}
 */
export async function resolveLlmProvider({ mock = false, env = process.env, overrides = {}, deps = {}, onWarn } = {}) {
  const config = resolveLlmConfig({ env, overrides });

  // Mock always wins, and it wins BEFORE any SDK module is touched: the offline
  // acceptance contract (no network, no key, no SDK install) is the floor.
  if (mock || config.provider === "mock") return { provider: null, config: { ...config, provider: "mock" } };
  if (!isSdkProvider(config.provider)) return { provider: null, config };

  try {
    return { provider: await createSdkProvider({ provider: config.provider, config, env, deps }), config };
  } catch (err) {
    if (config.allowMockFallback && err instanceof LlmProviderError) {
      onWarn?.(`${err.message}\n  HARNESS_ALLOW_MOCK_FALLBACK=1 is set — continuing with the mock provider.`);
      return { provider: null, config: { ...config, provider: "mock", fallback_reason: err.message } };
    }
    throw err;
  }
}
