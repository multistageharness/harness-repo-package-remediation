# `@harness/langgraph-harness-integration` — harness ↔ langgraph-harness reference integration

A **harness-owned** langgraph-harness config pack that extends the vendored langgraph-harness platform
(`../langgraph-harness/`, a pristine subtree mirror) with `@harness/` CSV/XLSX ingestion. It proves, end-to-end
and **mock-first**, how harness feeds normalized rows into langgraph-harness's atomic flow engine.

This package lives **beside** the mirror — never inside it — so `git subtree pull` on `../langgraph-harness/`
stays a clean fast-forward. See `../README.md` (vendors) for the mirror's provenance + update rail,
and [`ANALYSIS.md`](./ANALYSIS.md) for the full two-stack analysis and seam inventory.

## What's in the pack

```
bin/
  flow.mjs                      the `flow` wizard entry (shebang shim)
src/
  wizard.mjs                    orchestrator: walk steps → materialize → validate → run → report
  ui/
    prompter.mjs                the Prompter contract (text/select/multiselect/confirm) + resolvers
    clack-prompter.mjs          interactive binding — @clack/prompts + chalk (bin uses this)
    search-multiselect.mjs      custom @clack/core header picker — Space/Tab toggle, any key filters
    scripted-prompter.mjs       offline, no-TTY binding — replays answers, captures a transcript (tests)
  sdk.mjs                       single relative-import site into the vendored @internal/langgraph-langchain-harness-sdk
  flow-plan.mjs                 buildFlowPlan() — validate the collected answers
  render-flow.mjs               renderFlowYaml() — emit a concrete flow yaml from the plan
  materialize.mjs               writeFlow() — atomic write into gitignored .runs/wizard/
  run-flow.mjs                  validate + compile + run + progress + issue→step re-route
  steps/                        input-file, preview, header-select, repo-column, mapping,
                                labels-mode, output, confirm, report
configs/
  patterns/harness-ingest.mjs   commands.harnessIngest — the bridge atom (wraps @harness/sdk ingest())
  mapping.yaml                  version 100, extends: default, + one pattern line
  flows/harness-ingest-classify.yaml   the reference ingest → classify → render flow
  prompts/                      (inline prompt files — none yet)
test/
  harness-ingest.test.mjs       mock-first atom test (offline)
  ingest-classify-flow.test.mjs mock-first full-flow test (offline)
  prompter.test.mjs             unit test for the scripted Prompter binding (offline)
  flow-wizard.test.mjs          scripted e2e test for the whole wizard (offline)
```

### The reference flow: `ingest → classify → render`

```
CSV/XLSX ─▶ commands.harnessIngest ─▶ state.rows ─▶ nodes.fanout / edges.fanout (Send, one branch/row)
              (wraps @harness/sdk ingest())               │
                                                          ▼
                                             skills.classify (ctx.llm, mock) ─▶ state.labels (concat)
                                                          │
                                                          ▼
                              commands.renderReport + template.jsonReport ─▶ state.report ─▶ END
```

`skills.classify` reasons over each row through langgraph-harness's single LLM seam (`ctx.llm`) in **mock** mode
— deterministic, no key, no network. `labels.length === rows.length` (one label per ingested row).

## Run it

```sh
# From the repo root — validate + run via the VENDORED langgraph-harness CLI against this pack:
LANGGRAPH_LANGCHAIN_HARNESS=harness-repo-package-remediation/vendors/langgraph-harness/cli/src/main.mjs
PACK=harness-repo-package-remediation/vendors/langgraph-harness-integration
node $LANGGRAPH_LANGCHAIN_HARNESS validate harness-ingest-classify --mapping $PACK/configs/mapping.yaml --flows-dir $PACK/configs/flows
node $LANGGRAPH_LANGCHAIN_HARNESS run      harness-ingest-classify --mock --mapping $PACK/configs/mapping.yaml --flows-dir $PACK/configs/flows --json

# Or run this pack's own offline gate (all tests):
npm --prefix harness-repo-package-remediation/vendors/langgraph-harness-integration run verify
```

### The repo-remediation flow: `ingest → dataset → select → dedup → clone → render`

`configs/flows/repo-remediation.yaml` implements steps 2–5 of `../../langgraph-flow.md`:
seed the `dataset` spine from ingest, record a working header subset (originals kept),
normalize + dedup the repo-URL column into `dataset.repos`, then **fan out** to clone
each repo via the vendored `commands.gitClone` and render a JSON report.

```
CSV/XLSX ─▶ commands.harnessIngest ─▶ rows ─▶ commands.datasetInit ─▶ dataset (rows + original_headers)
   ─▶ commands.selectHeaders ─▶ dataset.selected_headers ─▶ commands.collectRepos ─▶ dataset.repos (+ flat repos)
   ─▶ nodes.fanout / edges.fanout (one branch per repo) ─▶ commands.gitClone ─▶ clone_results (concat)
   ─▶ commands.renderReport + template.jsonReport ─▶ report ─▶ END
```

**Clone location.** `commands.gitClone` resolves its relative `workspace` against the flow
yaml's directory (`ctx.options.baseDir`). This flow sets `workspace: "../../.harness/repos"`,
so from `configs/flows/` the clones land at the **pack root** —
`vendors/langgraph-harness-integration/.harness/repos/<owner>__<repo>` — which is
gitignored (`.harness/`). Under `--mock` no git/network runs; each branch yields a
`{ dir, url, mocked: true }` fixture.

### The repo-snapshot flow: `… → clone → snapshot → render`

`configs/flows/repo-snapshot.yaml` extends the same ingest→dedup→clone spine with a
`commands.repoSnapshot` leg that walks each clone's **tracked** filesystem
(`git ls-files`, `.gitignore` honored) and writes a per-repo basename→paths inventory —
the `.snapshot.json` contract (change records 0008/D2 + 0009/D5).

```
… ─▶ commands.gitClone ─▶ clone_results ─▶ commands.repoSnapshot ─▶ snapshots ─▶ render
```

**Artifact location, suffix, and name** (change record 0014/D1). Like every other
`.harness/` output, `out_dir: "../../.harness/repo-snapshots"` resolves against the flow
yaml's directory (`ctx.options.baseDir`), so the files land at the **pack root**, a sibling
of `repos/`, `fingerprints.json`, and `integrated.json`:

```
vendors/langgraph-harness-integration/.harness/repo-snapshots/<slug>.snapshot.json
```

- Suffix is **`.snapshot.json`** (singular), not `.snapshots.json`.
- `<slug>` is the **clone-dir basename** (the full slug), e.g.
  `carlosmarte-testcases-vulnerabilities__multi-repo-npm.snapshot.json` — not a short repo name.
- The path is **pack-relative** under `../../.harness/`, not the repo-root `harness-repo-package-remediation/.harness/`.

**Populated inventory vs. mock stub** (change record 0014/A1). The flow declares
`runtime.mock: ${MOCK:true}`, so **mock is on by default**. A default run writes a small
*representative* stub — a populated `<basename>:[paths]` map + collision index that
demonstrates the real shape (aligning with record 0005's mock-artifact rule), but **not** a
real enumeration of the clone. To produce the **real** `<filename>:[locations]` inventory of
the actual cloned trees, run with real git enumeration by setting `MOCK=false` (consumed by
`mock: ${MOCK:true}`):

```sh
LANGGRAPH_LANGCHAIN_HARNESS=harness-repo-package-remediation/vendors/langgraph-harness/cli/src/main.mjs
PACK=harness-repo-package-remediation/vendors/langgraph-harness-integration
# Default (offline): representative stub snapshots.
node $LANGGRAPH_LANGCHAIN_HARNESS run repo-snapshot --mapping $PACK/configs/mapping.yaml --flows-dir $PACK/configs/flows --json
# Real git enumeration: populated per-repo snapshots of the actual clones.
MOCK=false node $LANGGRAPH_LANGCHAIN_HARNESS run repo-snapshot --mapping $PACK/configs/mapping.yaml --flows-dir $PACK/configs/flows --json
```

## Interactive flow wizard (`flow`)

Instead of hand-editing yaml, walk the same `ingest → classify → render` flow interactively. The
wizard prompts for each piece of the config, previews the parsed rows, materializes a concrete flow
yaml, then validates + runs it through the vendored `@internal/langgraph-langchain-harness-sdk` **under mock** and prints the report.
The interactive UI is built on [`@clack/prompts`](https://github.com/bombshell-dev/clack) + `chalk`. The
header picker is a custom `@clack/core` prompt (`src/ui/search-multiselect.mjs`) where **Space/Tab toggle**
the highlighted row and **any other key filters** the list; everything is offline and never writes outward.
Steps program against a small `Prompter` seam (`src/ui/`), so the whole wizard is driveable in tests
through a scripted, no-TTY binding — no terminal, no network, no key, no git.

```sh
# From the pack directory (or via the linked `flow` bin after `npm link`):
node harness-repo-package-remediation/vendors/langgraph-harness-integration/bin/flow.mjs
```

**The steps, in order:**

1. **Input file** — prompt for a `.csv`/`.xlsx` path (resolved against your cwd); re-asks on a missing
   file or unsupported extension. Type `abort` to quit.
2. **Preview** — `@harness/sdk` `ingest()` prints the columns, the first rows, and the total count. An
   ingest *error* diagnostic re-routes you back to step 1.
3. **Mapping & ingest pattern** — lists the mappable patterns (from `configs/mapping.yaml`, grouped by
   category) and fixes the ingest atom. Default: `commands.harnessIngest`.
4. **Labels** — the classify enum (≥2, comma-separated). Default: `person, other`.
5. **Mode** — mock (offline) vs real. Default: **mock**. See real mode below.
6. **Output** — report directory + filename. Defaults: `.runs/out` / `harness-ingest-classify.json`.
7. **Confirm** — a summary of the walked config + the materialized yaml path; declining exits `0`
   without running.
8. **Validate → run → report** — validation failures print each `path: message` and route you back to
   the owning step (bounded); a clean run streams per-node progress, then prints one label per row and
   the written artifact path. Exit code: `0` on a completed run, non-zero on a runtime failure.

The materialized yaml is written to the gitignored `.runs/wizard/` — the pristine mirror is never
touched.

**Real mode (env-switched, deliberate):** select *real* at step 5 and confirm. The wizard **never
prompts for or stores a credential** — export them first and they are read at the SDK seam:

```sh
export LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=…            # or LANGGRAPH_LANGCHAIN_HARNESS_LLM_BASE_URL for a compatible endpoint
node harness-repo-package-remediation/vendors/langgraph-harness-integration/bin/flow.mjs
```

If real mode is requested but no credentials are found, the provider falls back to mock and the report
prints a visible fallback notice — the run still completes offline.

**Guardrails:** mock-first by default; credentials via env only (never prompted, logged, or committed);
no outward writes (artifacts land only under `.runs/`); the vendored mirror is consumed, never edited.

## How `@harness/sdk` and `@internal/langgraph-langchain-harness-sdk` resolve (resolution strategy)

Two independent install roots meet here (see ANALYSIS §3):

- **`@harness/sdk`** — resolved via **npm workspace** (option A). This pack is listed in the harness
  root `package.json` `workspaces` as `vendors/langgraph-harness-integration`, so `npm install` at the harness
  root symlinks `@harness/sdk` (and its `@harness/core` dep) into the root `node_modules`. The atom
  imports it as a clean bare specifier: `import { ingest } from "@harness/sdk"`. Tradeoff: the pack
  joins harness's install; the vendored langgraph-harness mirror stays a **separate** install root.
- **`@internal/langgraph-langchain-harness-sdk`** — imported by the flow **test** via a relative path into the mirror
  (`../../langgraph-harness/sdk/src/index.mjs`), **not** as a declared dependency. This keeps langgraph-harness's frozen
  LangChain pins (`@langchain/core` 1.1.48, `@langchain/langgraph` 1.3.4, …) isolated inside the
  mirror's own `node_modules` and out of harness's tree. Install the mirror once so those pins are
  present: `npm --prefix harness-repo-package-remediation/vendors/langgraph-harness install`.

The langgraph-harness **trust boundary** is satisfied because the *mapping* entry is `./patterns/harness-ingest.mjs`
(relative, under the mapping dir). What the atom *imports internally* (`@harness/sdk`) is a normal
Node ESM import and is not constrained by the mapping's trust rule.

## Recipe — add a new source-type atom (`commands.<source>Ingest`)

1. **Atom** — add `configs/patterns/<source>-ingest.mjs`: export `meta` (`name:
   "commands.<source>Ingest"`, `category: "commands"`, a mini-JSON-Schema `params`, `returns:
   "node"`) plus one factory `fn(params, ctx) → async (state) => delta` that delegates to
   `@harness/sdk` and writes ONLY its declared `out` channel. Model it on
   `configs/patterns/harness-ingest.mjs` and the built-in `../langgraph-harness/sdk/src/atoms/commands/fs-read.mjs`.
2. **Mapping** — add one line under `patterns:` in `configs/mapping.yaml`:
   `commands.<source>Ingest: { module: "./patterns/<source>-ingest.mjs", export: <source>Ingest }`.
   (The growth rule: one atom file + one mapping line — never touch the compiler/executor/loader.)
3. **Flow** — reference the atom from a flow yaml under `configs/flows/`, with tight `reads:`/`writes:`
   and bounded edges (`edges.loop {max, on_max}` or `edges.fanout`).
4. **Test** — add a mock-first `test/<source>-*.test.mjs` (offline; assert the atom + flow produce
   deterministic output). Wire it under the pack's `verify` script.

## Guardrails (binding — see `.claude/rules/` and ANALYSIS §9)

- **Mock-first** — the default gate is offline: no network, no API key, no git. Real providers are
  env-switched (`LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) and exercised deliberately,
  never in the default gate. *(security rule 8)*
- **`ctx.llm`-only** — atoms reach models solely through langgraph-harness's LLM seam; no provider SDK import in
  an atom. *(platform rule 2; security rule 5)*
- **Credentials via env only** — never in flow yaml, state, events, logs, fixtures, or commits.
  *(security rules 5, 6)*
- **Trust boundary** — custom pattern modules live under this pack's `configs/` subtree; no `../`
  escape, no foreign bare specifier in the mapping. *(platform rule 6)*
- **Bounded iteration** — every loop/fanout edge is bounded (`max` + `on_max`). *(platform rule 4)*
- **No unconfirmed outward writes** — the flow writes only local files under `.runs/`; nothing is
  posted or published without explicit user confirmation. *(security rule 7)*
- **Pristine mirror** — never edit `../langgraph-harness/`; all integration code lives here. *(vendors README)*
