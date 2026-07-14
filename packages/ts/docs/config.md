# `harness.config.json` — the LLM toggle

The one configuration file in the toolkit (change record 0062/D3). It selects and tunes the
LLM provider behind the `ctx.llm` seam — nothing else reads it. Everything else in the harness
stays env-driven ([env.md](env.md)) or flow-yaml-driven.

Two facts worth stating once:

- **The live file is never committed and never auto-created.** `harness-repo-package-remediation/harness.config.json` is
  gitignored; [`harness.config.example.json`](../harness.config.example.json) is the committed
  template. You copy it by hand, or you run without one — a missing file is a normal, silent
  condition (`ENOENT → {}`), not an error.
- **Credentials never go in this file** (security rule 5). Each provider reads its own key from
  the process environment at the seam (`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` for
  `claude-sdk` and `anthropic`; the Copilot SDK resolves its own auth). A key in this file would
  be a bug, not a convenience.

## Quick start

```sh
cd harness
cp harness.config.example.json harness.config.json   # gitignored; safe to edit
$EDITOR harness.config.json
export ANTHROPIC_API_KEY=…                            # credential stays in the environment
MOCK=false make start
```

The wizard prints the resolved provider and model **before** the run starts
(`vendors/langgraph-harness-integration/src/run-flow.mjs`), so "which model is about to read a
dozen third-party repos" is answered on screen, not inferred from `result.mode` in an artifact.

## Shape

Only the top-level `llm` key is read (`readConfigFileLayer`,
`vendors/langgraph-harness-integration/src/llm/config.mjs`). Unknown keys inside `llm` are
carried along harmlessly; keys outside `llm` (including the template's `$comment`) are ignored.

```json
{
  "llm": {
    "provider": "claude-sdk",
    "model": "claude-opus-4-8",
    "maxTokens": 16000,
    "temperature": 0,
    "reasoningEffort": "low",
    "maxRetries": 3,
    "timeout": 60000,
    "tokenBudget": { "maxTokens": 200000, "enforcement": "warn" },
    "allowMockFallback": false
  }
}
```

## Precedence — `defaults < harness.config.json < ENV < flow param`

Resolved by `resolveLlmConfig` (`src/llm/config.mjs`), the same chain both vendored SDKs use
internally, so there is exactly one mental model:

1. **defaults** — `defaultLlmConfig()` in code, not a file. Provider `mock`: no key, no network,
   no SDK loaded.
2. **config file** — `harness-repo-package-remediation/harness.config.json`, or wherever `HARNESS_CONFIG_FILE` points.
3. **environment** — the `LANGGRAPH_LANGCHAIN_HARNESS_LLM_*` variables
   ([env.md § LLM provider](env.md#llm-provider)). Any env var set outranks the same key in the
   file.
4. **flow param** — a node's `with: { model: … }` in the flow yaml outranks everything for the
   model id (it rides through `callLlm` as a per-call option).

Underneath rung 1 there is one more layer to be aware of: **the SDKs' own env defaults**. If the
harness chain leaves `model` unset (`null`), the selected SDK fills it from *its* environment
(`CLAUDE_MODEL` for claude-sdk, `COPILOT_CLI_MODEL` for github-sdk) before falling back to its
built-in default (`claude-opus-4-8` / `gpt-5-mini`).

## Key reference

Defaults from `defaultLlmConfig()`. The **lane** column says where the knob actually lands —
several are provider-specific, and the legacy raw-fetch lane ignores this file entirely (see the
warning below).

| Key | Default | Lane | Purpose |
|---|---|---|---|
| `provider` | `"mock"` | all (see warning) | `mock` · `anthropic` · `openai` · `claude-sdk` · `github-sdk`. Anything else throws `LlmConfigError` — an unknown name is refused, never silently mocked. |
| `model` | `null` (SDK default) | SDK lane | Model id. Left `null` on purpose in the template-of-record: pinning one here would hand a Claude model id to Copilot the moment the toggle flips. |
| `maxTokens` | `16000` | claude-sdk only | Output cap per reply. The old raw-fetch lane keeps its hard-wired 2048; the Copilot session API has no such knob (silently inert on github-sdk). |
| `temperature` | `0` | claude-sdk only | Determinism knob, sent via the SDK's `requestDefaults` passthrough. The Copilot session API has no temperature. |
| `reasoningEffort` | `null` (SDK default `low`) | both SDKs | `low` · `medium` · `high` — validated by the SDK. |
| `maxRetries` | `3` | claude-sdk only | Retry count inside the Anthropic client (429/5xx/network) — a rate limit on repo #7 of 12 is retried inside the SDK instead of killing the run. Inert on github-sdk (the Copilot runtime manages its own). |
| `timeout` | `60000` | both SDKs | Per-request timeout in ms (claude-sdk: client `timeout`; github-sdk: `requestTimeoutMs`). |
| `tokenBudget` | `null` | both SDKs | `{ "maxTokens": n, "enforcement": "warn" \| "block" }` — a whole-run token ceiling. `warn` emits and continues; `block` throws before the request. |
| `allowMockFallback` | `false` | SDK lane | `true` restores the old soft behavior: a requested SDK that cannot be constructed degrades to mock (with a warning) instead of aborting. Same dial as `HARNESS_ALLOW_MOCK_FALLBACK=1`. |

> **Warning — `provider: "anthropic"` / `"openai"` in this file does not work today.** The config
> file is resolved by the integration pack, which constructs and injects only the SDK lane
> (`claude-sdk` / `github-sdk`). The legacy raw-fetch lane is built by the platform's own seam
> (`vendors/langgraph-harness/sdk/src/llm/provider.mjs`), which reads **environment variables
> only** — so a legacy provider named in the file is printed by the wizard but the run falls back
> to mock with `"no LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER configured"`. To use the legacy lane,
> export `LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=anthropic` (plus its credential) in the
> environment instead.

## The two lanes fail differently — on purpose

- **`mock`** (the floor): always available, offline, deterministic. `MOCK=true` (the default)
  outranks every provider selection — the whole graph runs with no network, no key, no SDK import.
- **SDK lane** (`claude-sdk`, `github-sdk`): a requested provider that cannot be constructed —
  dangling `vendors/claude-sdk` / `vendors/github-sdk` symlink, missing credential, SDK not
  `npm install`ed in its sibling checkout — **aborts the run** with a named `LlmProviderError`
  before the first repo is read. It does not silently become a mock run. Opt out with
  `allowMockFallback` / `HARNESS_ALLOW_MOCK_FALLBACK=1`.
- **legacy lane** (`anthropic`, `openai`, env-selected): a missing credential degrades softly to
  mock and reports why in `fallback_reason` — unchanged historical behavior.

## Failure modes of the file itself

| Condition | Behavior |
|---|---|
| File absent | Normal. The chain runs on defaults + env. |
| File present, valid, `provider` unknown | `LlmConfigError` — the run refuses to start. |
| File is malformed JSON | `LlmConfigError` — **including `--mock` runs**: the config is parsed before the mock short-circuit, so a broken file fails loudly rather than being half-read. If a mock run ever throws `LlmConfigError`, check this file first. |
| `HARNESS_CONFIG_FILE` points at an unreadable path | `LlmConfigError` naming the path (a *missing* file at that path is still treated as absent). |

## Recipes

```sh
# 1 — offline (default): no file, no env, nothing to do
make start

# 2 — claude-sdk via the file, credential in the env
cp harness.config.example.json harness.config.json     # provider: claude-sdk
export ANTHROPIC_API_KEY=…
MOCK=false make start

# 3 — github-sdk for one run, without touching the file
export LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=github-sdk
MOCK=false make start

# 4 — override a single knob for one run (env outranks the file)
export LANGGRAPH_LANGCHAIN_HARNESS_LLM_MODEL=claude-sonnet-5
MOCK=false make start

# 5 — a config file somewhere else (CI, per-project)
export HARNESS_CONFIG_FILE=/path/to/my-harness.config.json
```

## Where this is implemented

| Concern | Path |
|---|---|
| Precedence chain, key defaults, env mapping | `vendors/langgraph-harness-integration/src/llm/config.mjs` |
| SDK adapter, fail-loud construction, mock floor | `vendors/langgraph-harness-integration/src/llm/sdk-provider.mjs` |
| Resolution + injection + confirmation line | `vendors/langgraph-harness-integration/src/run-flow.mjs` |
| Legacy env-only lane (this file does not reach it) | `vendors/langgraph-harness/sdk/src/llm/provider.mjs` |
| Committed template | [`harness.config.example.json`](../harness.config.example.json) |
| Env variable reference | [env.md § LLM provider](env.md#llm-provider) |
