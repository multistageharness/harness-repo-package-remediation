# Environment variables

Every environment variable read anywhere under `harness-repo-package-remediation/`, grouped by the seam that reads it.

Two facts hold across the whole toolkit and are worth stating once:

- **There is no `.env` loading.** No `dotenv`, no autoloaded profile. Every variable below comes
  from the real process environment — you export it, or it is unset. The one config file in the
  toolkit is the LLM toggle's gitignored `harness.config.json` ([config.md](config.md)), and env
  always outranks it.
- **Credentials are env-only** (security rule 5). API keys are read at the seam that needs them
  and never appear in flow yaml, state channels, events, logs, fixtures, or commits.

Everything here is **optional**: every variable has a default, and the toolkit runs end-to-end
under `--mock` with an entirely empty environment. Nothing in this table is required to get a
green `npm run verify`.

## Flow inputs

Flow yaml interpolates `${VAR}` / `${VAR:default}` through `interpolateEnv`
(`vendors/langgraph-harness/sdk/src/loader/config-loader.mjs:65`). Precedence is
**process env › inline `${VAR:default}` › the flow's declared `env:` default › `""`**; a variable
declared `required` with no value throws `MissingEnvError`.

| Variable | Default | Purpose |
|---|---|---|
| `MOCK` | `true` | The master switch. `true` runs the whole graph offline — no network, no API key, no git. Set `MOCK=false` for a real run. Read by 15 flows across both packs. |
| `INGEST_SOURCE` | `local_csv` | Which lane the step-1 ingest router takes (`configs/flows/repo-remediation.yaml:41`). |
| `INGEST_REF` | `../../../../fixtures/dependabot-remediation-testcases.csv` | The artifact the chosen ingest lane reads. |
| `DEPGRAPH_SAVE_DIR` | `../../.harness/dependency-graphs` | Where the dependency-graph flow writes its output (`configs/flows/dependency-graph.yaml`, `src/steps/output.mjs`). |
| `ANSWER_MODEL` | `mock-model` | The model name in the `linear-rag` example flow — the only flow with a declared `env:` block. |

## LLM provider

One dial — `LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER` — selects where model bytes go, across
**two lanes**:

- the **legacy lane** (`anthropic`, `openai`) — raw `fetch` inside
  `createLlmProvider` (`vendors/langgraph-harness/sdk/src/llm/provider.mjs`). No retry, no
  timeout, `max_tokens` fixed at 2048. Credential-only, retained unchanged.
- the **SDK lane** (`claude-sdk`, `github-sdk`) — the vendored harness SDKs at
  `vendors/claude-sdk` / `vendors/github-sdk`, resolved and injected by the integration pack
  (`vendors/langgraph-harness-integration/src/llm/`). Retries, timeout, token budget, a
  structured-output repair loop, usage accounting — and `model` / `maxTokens` / `temperature`
  are real configuration rather than constants.

`mock` is the default and the floor: with no config and no env, nothing is loaded, nothing is
called, and `MOCK=true` runs the entire graph offline.

### Precedence — `defaults < harness.config.json < ENV < flow param`

The same chain both SDKs use themselves. `harness-repo-package-remediation/harness.config.json` is **gitignored**; copy
[`harness.config.example.json`](../harness.config.example.json) and edit. A node's
`with: { model: … }` still outranks everything for the model id. Full key reference, per-provider
applicability, and failure modes: [config.md](config.md).

| Variable | Default | Purpose |
|---|---|---|
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER` | `""` (→ mock) | `mock` · `anthropic` · `openai` · `claude-sdk` · `github-sdk`. Unset means mock, even when `MOCK=false`. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_MODEL` | provider/SDK default | Model id. A flow's explicit `model` option outranks it. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_MAX_TOKENS` | `16000` (SDK lane) | Output cap. The legacy lane ignores it and stays at 2048. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_TEMPERATURE` | `0` (SDK lane) | Determinism knob. `claude-sdk` only — the Copilot session API has no temperature. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_REASONING_EFFORT` | SDK default (`low`) | SDK lane only. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_MAX_RETRIES` | `3` | SDK lane only — a 429 on repo #7 of 12 is retried inside the SDK. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_TIMEOUT_MS` | `60000` | SDK lane only. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_TOKEN_BUDGET` | — | Whole-run token ceiling (`enforcement: warn`). SDK lane only. |
| `HARNESS_CONFIG_FILE` | `harness-repo-package-remediation/harness.config.json` | Where the config-file rung is read from. |
| `HARNESS_ALLOW_MOCK_FALLBACK` | unset | `1` restores the old soft behavior: an unbuildable SDK provider degrades to mock instead of aborting. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | — | Credential for `anthropic` and `claude-sdk`. Read at the seam only; never in yaml, channels, logs, or commits. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_BASE_URL` | — | Required by the legacy `openai` provider — the OpenAI-compatible endpoint. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LLM_API_KEY` | `""` | Key for that endpoint. Optional — a local runtime may need none. |

### The two lanes fail differently — on purpose

**Legacy lane:** a missing credential degrades to mock and reports why in `fallback_reason`. It
never throws and never makes a network call.

**SDK lane:** a requested SDK that cannot be constructed — dangling symlink, missing credential,
SDK not installed — **aborts the run** with a named `LlmProviderError`. It does *not* quietly
become a mock run: waiting through a 12-repo clone/fingerprint/plan fan-out only to receive mock
detections is a silent failure, and refusing to start is the honest answer. Opt out with
`HARNESS_ALLOW_MOCK_FALLBACK=1`.

```sh
# SDK lane (retry/timeout/budget/repair, configurable model + max_tokens)
export LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=claude-sdk
export ANTHROPIC_API_KEY=…
MOCK=false make start

# legacy raw-fetch lane
export LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=…
MOCK=false make start
```

The wizard prints the resolved provider and model before the run starts, so "which model just read
a dozen third-party repos" is answered on screen — not inferred from `result.mode` in an artifact
afterwards.

## Session and artifact paths

Read by the integration pack to decide where `.harness/` artifacts land. The two render-path
variables are the **ENV rung of an ARG › ENV › default ladder** — the matching CLI flag always wins.

| Variable | Default | Purpose |
|---|---|---|
| `HARNESS_SESSION_ID` | interactive prompt | Pins the run's artifact root to `.harness/<id>/` and skips the wizard's session prompts, making a scripted run deterministic and leaving no orphan session dir (`src/wizard.mjs:128`). Precedence: explicit option › env › prompt. |
| `HARNESS_RENDER_ROOT` | `cwd` | The base directory that contains `.harness/`. Relative values resolve against `cwd`. Outranked by `--harness-render-root` (`src/session-lib.mjs:108`). |
| `HARNESS_RENDER_PACKAGE` | `basename(pkgDir)` | The path segment naming the pack whose artifacts are rendered. Must be a single traversal-free segment — anything else throws. Outranked by `--harness-render-package` (`src/session-lib.mjs:120`). |
| `HARNESS_SKILLS_DIR` | `harness-repo-package-remediation/skills/` | Where the skill registry loads from (`src/skill-registry.mjs:32`). |
| `HARNESS_TOOLS_DIR` | `harness-repo-package-remediation/tools/` | Where the tool registry loads from (`src/tool-registry.mjs:60`). |

## Service health

The flow's first node probes the services the run depends on and publishes the result on the
`service_health` channel (plan `run-health-and-errors-log`). The probed set is **declarative**:
`harness.config.json`'s top-level `services:` array (see `harness.config.example.json`), falling
back to `[docker, verdaccio, devpi]` when unset. Each entry is `{ id, kind, ..., remedy }` where
`kind` selects a closed probe strategy — `docker` (argv `["docker","info"]`), `registry`
(delegates to the registry preflight for the `npm`/`pip` lane endpoint), `http` (reachability GET
against an `origin`), or `port` (TCP connect against `{host, port}`). The entry's `remedy` string
is what the errors verdict and the CLI exit line print — it is data, configured once, not a
sentence duplicated per call site. Adding a fourth service is one config entry; no code changes.

`HARNESS_CONFIG_FILE` (documented under **LLM provider**) points at an alternate config file and
governs this key too. Under `--mock` no probe runs at all — no subprocess, no socket.

### Exit-code contract (`flow` / `make start`)

On exit the CLI prints the consolidated verdict (remedy first, never the symptom) and the absolute
path to `<session>/errors.logs`. The exit code follows the verdict (`src/run-flow.mjs`
`verdictExitCode`):

- **`0`** — a clean run, **or** a run whose only failures are environmental and correctly reported
  `blocked` (verdict `environment`). The pipeline did its job: it told the truth. Making this
  non-zero would break every CI wrapper the moment a registry hiccups — the over-correction that
  leads to `|| true`, which destroys the signal permanently.
- **`1`** — code-attributable failures exist (verdict `code` or `mixed`), or the flow itself did not
  complete.

If `errors.logs` is absent the errors stage did not run — the CLI says so explicitly (absence is
never a clean bill of health), and the exit code falls back to the legacy completed-without-clone-
failures rule. "Did the work actually happen" is a different question from "did the code break";
if CI must gate on it, that deserves a future `--fail-on-blocked` flag, not a repurposed exit code.

## Tracing

`disableTracing` (`vendors/langgraph-harness-integration/src/tracing.mjs`) runs before any graph is
compiled, on two rungs: an import-time side effect at the SDK chokepoint (`src/sdk.mjs` imports
`src/tracing-init.mjs`, which covers callers that deep-import the vendored SDK) and a call-time
pass in `runFlow` (`src/run-flow.mjs:44`). `@langchain/core` auto-exports a trace per graph run
whenever any of these switches is on, so an ambient LangSmith config in your shell would otherwise
ship every stage of every run to a third-party SaaS — and 429 once the tenant's trace quota is
spent. When the toolkit overrides a switch you had set, it says so in the run log rather than
silently flipping it.

| Variable | Direction | Purpose |
|---|---|---|
| `HARNESS_TRACING` | **read** | The opt-in escape hatch. `1`/`true`/`yes`/`on` leaves tracing alone. Unset means tracing is suppressed. |
| `LANGCHAIN_TRACING_V2`, `LANGSMITH_TRACING`, `LANGCHAIN_TRACING` | **written** | Not configuration — these are forced to `false` for the process unless `HARNESS_TRACING` is set. Whatever was actually on gets named in the run log. |
| `LANGCHAIN_API_KEY`, `LANGCHAIN_ENDPOINT` | **untouched** | Deliberately preserved. Disabling telemetry is the toolkit's business; mutating your credentials is not. |

## Server, CLI, and frontend

`vendors/langgraph-harness` — the backend service, the `langgraph-langchain-harness` CLI, and the
frontend dev proxy. Each `*_FLOWS_DIR` / `*_MAPPING` variable is the ENV rung under an equivalent
CLI flag (`--flows-dir`, `--mapping`).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7100` | Backend listen port (`backend/src/server.mjs:12`). |
| `HOST` | `127.0.0.1` | Backend bind address. Loopback by default — widen deliberately. |
| `LANGGRAPH_LANGCHAIN_HARNESS_API_TOKEN` | `""` (auth off) | When set, the backend requires a matching bearer token. Note the frontend has no auth UI for this yet. |
| `LANGGRAPH_LANGCHAIN_HARNESS_API_URL` | `http://127.0.0.1:7100` | Backend target for the frontend's Vite dev proxy. |
| `LANGGRAPH_LANGCHAIN_HARNESS_FLOWS_DIR` | `configs/flows` | Flow directory for the CLI and backend. Outranked by `--flows-dir`. |
| `LANGGRAPH_LANGCHAIN_HARNESS_MAPPING` | `configs/mapping.yaml` | Atom mapping file. Outranked by `--mapping`. |
| `LANGGRAPH_LANGCHAIN_HARNESS_LOG_LEVEL` | `info` | Logger level (`sdk/src/services/logger.mjs:14`). |
| `LANGGRAPH_LANGCHAIN_HARNESS_LOG_FORMAT` | `pretty` | Logger format — `pretty` or `json`. |

## HTML report dev server

`vendors/langgraph-repo-remediation-html-report-reactjs` (`dev/sessions.mjs`). By default the dev
server renders the newest report under `../../.harness/<session-id>/repo-remediation.html`. When no
session exists on disk it says so rather than falling back to a fixture — a fixture that looks like
a real report is how this package drifted once already.

| Variable | Default | Purpose |
|---|---|---|
| `HARNESS_REPORT_HTML` | newest session | Render one specific `repo-remediation.html`. |
| `HARNESS_SESSIONS_DIR` | `../../.harness` | Point the session picker at a different directory of `<session-id>/repo-remediation.html`. |

## repository-fingerprint

`vendors/repository-fingerprint` ships four language twins (bash, ts, py, powershell) plus a parity
harness that runs them against each other. These variables are the twins' only env surface.

| Variable | Default | Purpose |
|---|---|---|
| `RF_MATRIX` | repo-relative path | Override the signal-matrix file. Honored identically by all three twins (`bash/lib/matrix.sh`, `py/…/matrix.py`, `ts/src/matrix.ts`). |
| `RF_SCHEMA` | repo-relative path | Override the schema file. Same three twins. |
| `RF_BASH`, `RF_TS`, `RF_PY`, `RF_PWSH` | auto-detected | The command used to invoke each twin in the parity harness (`scripts/parity.mjs`), e.g. `RF_PY=.venv/bin/repo-fingerprint`. The powershell column is included only when `pwsh` is on `PATH` or `RF_PWSH` is set. |

## Tooling and ambient

Standard variables the toolkit honors but does not own.

| Variable | Default | Purpose |
|---|---|---|
| `MMDC` | auto-detected | Explicit path to `mermaid-cli` for `npm run graph`. Resolution order: `$MMDC` › local install › `PATH` (`scripts/graph-png.mjs:217`). |
| `CI` | unset | `CI=true` disables the progress bar's TTY animation (`vendors/tools-cli-progress-bar/main.mjs:29`). |
| `FORCE_COLOR` | unset | `FORCE_COLOR=0` disables progress-bar color. |
| `NODE_ENV` | unset | Read by the report package's Vite client/SSR configs only. |

## Not environment variables

Two names look like env vars in prose but are not — nothing reads either from the environment.
Named here so the next person doesn't go hunting.

- **`$VENV_PATH`** — appears in `configs/patterns/venv-setup.mjs` comments and in the pattern's
  `summary` string, but no code reads `process.env.VENV_PATH`. The venv path is a pattern input,
  not an env override. Setting it in your shell does nothing.
- **`$SYSTEM_PREAMBLE`** — a JS `const` interpolated into a template literal in
  `configs/patterns/optimize-prompt.mjs`, not an env reference.

## Registries (not read by this repo, but they will bite you)

Not consumed by any code under `harness-repo-package-remediation/`, but they govern whether the install and remediation
stages can resolve anything at all:

- The npm registry is a **local Verdaccio at `localhost:4873`**, and pip resolves through a **local
  devpi at `localhost:3141`** — both in Docker. When Docker is down, both refuse connections and
  installs burn retry backoff (npm: exactly 70s per command) before failing.
- The flow now runs a fail-fast registry preflight, but if you are debugging a "hanging" run by
  hand, check `lsof -ti tcp:4873` and `docker info` first.
