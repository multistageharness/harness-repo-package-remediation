# repo-remediation — langgraph flow

The remediation pipeline compiles from `vendors/langgraph-harness-integration/configs/flows/repo-remediation.yaml`
into a langgraph **`StateGraph`** (`vendors/langgraph-harness/sdk/src/compiler/graph-compiler.mjs`).
This doc mirrors that compiled graph — the numbered user-intent steps below are the "what", and the
topology / state spine are the source of truth (change record `0016`/A1). It is a **derived doc**:
regenerate it with the `generate-langgraph-flow` skill after any change to the flow rather than
hand-editing it. **33 nodes, 36 edges.**

> **Capability 9 — `diagnose` (reason-for-broken insight).** The DETERMINISTIC CORE is now **landed**
> (change record `0033`): `src/diagnose-lib.mjs` classifies a failed install/build step's captured
> output into `environment` (a down registry — `ECONNREFUSED` to Verdaccio `:4873` / devpi `:3141`),
> `toolchain` (a pre-existing `tsc` TS5107-style break), `lockfile-drift` (npm ci `EUSAGE`), or
> `dependency-conflict` (the edit's own fault). `install-verify` and `build-run` attach the dominant
> cause as `install_verifications[].cause` / `builds[].cause`; the pure `validate` stage then follows
> the causal chain install → build → test and dispositions each APPLIED edit — a benign cause →
> **blocked** (not the remediation's fault), an attributable/unexplained one → **broken**. This is the
> `remediation002` headline made executable: session `5cc983f3-5c72-4b7a-97f8-cf3c35e2d528` was
> reported 2 fixed / 10 broken, but with `0033` the SAME evidence scores **5 fixed / 0 broken /
> 7 blocked** — a **100% pass rate** (`fixed ÷ (fixed + broken + bug)`), exercised end-to-end by
> `test/remediation002-matrix.test.mjs`. Cause C (the `install-verify` false-negative on lockfile-less
> repos) is also fixed there (recovered-primary skip + exit-code honesty). The concrete run insight
> lives in `.ai/harness-repo-remediation/analysis/remediation002/findings/`. What remains **pending
> compilation** is only the OPTIONAL LLM-authored human-readable narrative (a `skills.diagnoseBroken`
> node emitting a prose reason + suggested resolution per outcome); the classification the report acts
> on no longer needs it. Adding that node (→ 34 nodes / 37 edges) requires wiring
> `configs/flows/repo-remediation.yaml` + a `diagnose` pattern and regenerating this doc. The `33
> nodes / 36 edges` count reflects the committed yaml (the diagnosis lives inside
> the existing `install-verify` / `build` / `validate` nodes).

## State spine

Every stage reads and writes the shared `dataset` object plus a few flat channels:

- `dataset` — `{ original_headers, selected_headers, rows, repo_column, repos, clone_results }`
- step-2 ingest inputs — `ingest_source` (a closed enum: `local_csv | remote_csv | local_repo |
  remote_repo | preset_list | dependabot`, default `${INGEST_SOURCE:local_csv}`) and `ingest_ref`
  (the path / URL / preset id that lane consumes, default `${INGEST_REF:…}`); change record `0021`/A1
- fan-out channels — `repos`, `repos_item`, `repos_index`, `clone_results` (reducer `concat`);
  and, for step 12, `fingerprints_item`, `fingerprints_index`, `dependency_graphs` (reducer `concat`)
- per-stage outputs — `rows`, `fingerprints`, `integrated`, `plans`, `plans_ruled` (the
  policy-stamped decided-actions channel, `0032`/D5), `optimized_prompts`,
  `remediations`, `snapshots`, `installs`, `install_verifications`, `dependency_graphs`, `builds`,
  `tests`, `validations`, `changelogs` (release range + source/compare URL per applied remediation,
  `0032`/D6), `build_snapshots`, `fingerprints_report`, `integrated_report`,
  `dependency_graph_report`, `remediation_summary`, `report`, `report_html`,
  `final_applied_changes` (the step-18¾ export summary — where each repo's changed files were
  copied, and the per-repo ledger of what changed; its NODE is `export_changes`, since langgraph
  forbids a node named after a channel), `errors_summary`
  (the terminal errors stage's verdict — cause, remedy, blast radius, and the absolute
  `errors.logs` path the CLI exit line reads back; plan `run-health-and-errors-log` Epic 02)
- run-scoped facts — `service_health` (plan `run-health-and-errors-log` Epic 01): the up-front
  service probe result `{ ok, services: [{ id, kind, status, detail, remedy, evidence }] }` the
  `health` entry node publishes (declarative set from `harness.config.json` `services:`, default
  docker + verdaccio + devpi) — quoted by the terminal `errors` stage and stamped into the HTML
  report's environment banner; and `registry_preflight` (`0063`/A2, completing `0054`/D1): the
  once-per-run registry reachability result `{ ok, lanes, checked[], unreachable[] }` the
  `preflight` node publishes and the `install`, `build`, and `run_test` stages all consume via
  `preflight_from`
- capability channels (langgraph-flow.md capabilities 4/1/6/9/7/8) — `plans` (deterministic per-repo
  remediation plan), `optimized_prompts` (LLM-optimized SDK prompt per repo), `tests` (test-stage
  results), `validations` (fixed/broken/blocked/skipped/bug ledger per repo — with the `0033`
  environment/pre-existing → **blocked** disposition carried on each `install_verifications[].cause` /
  `builds[].cause` and consumed by `validate`), `diagnostics` (capability 9 — the OPTIONAL
  LLM-authored per-outcome prose narrative, **pending compilation**; the deterministic cause tagging
  it would annotate is already landed, `0033`), `remediation_summary`
  (per-repo markdown + aggregate JSON report node result), `report_html` (single-HTML report result)

`*_item` / `*_index` are the derived per-branch channels the Send API seeds; `clone_results` and
`dependency_graphs` are the only reduced (`concat`) channels — every other channel is last-write-wins.

**`dataset` is written twice** — seeded by `dataset_init` (+ `select_headers`, `collect_repos`), then
**re-stamped in place** by step 7½'s `resolve_datasource` (`0065`/D1), which resolves each row's
optional `dependency_scope` / `manifest_path` against the clone on disk and writes the resolved value
plus its provenance back onto the same channel. Every downstream reader of `dataset` (`plan`,
`apply_rules`, `remediate`, `validate`'s contract C1) therefore reads **resolved** rows, and cannot
disagree about what a row means.

## Topology

```
START → health → ingest → dataset_init ─┬─[default]────→ select_headers ─┐
   (service probe   (nodes.subgraph       │                                 │
    → service_       configs/flows/       └─[ingest_source=local_repo ]─────┤
      health)        ingest.yaml: router    [ingest_source=remote_repo]     │
                     ∨ 6 source lanes)                                      ▼
                                                           collect_repos → fan
                                                                            │
                                          Send API — one branch ∀ repos[i]  │
                                                                            ▼
                                                                       clone_repo
                                                                            │ join
                                                                            ▼
   fingerprint → fingerprint_report → resolve_datasource → integrate → integrate_report → plan → apply_rules → optimize → remediate → snapshot → preflight → install → install_verify → depgraph_fan
                                          (0065/D1)                                      (cap 4a)  (0032/D5)      (4b)        (5)                 (0063/A2)                                    │
                                                                             Send API — one branch ∀ fingerprints[i]                                                                          │
                                                                                                               ┌─────────────────────────────────────────────────────────────────────────────┘
                                                                                                               ▼
                                                                                          dependency_graph  (nodes.subgraph)
                                                                                                               │ join
                                                                                                               ▼
      depgraph_report → build → build_snapshot → run_test → validate → changelog ┄→ (diagnose) → remediation_report → render → html_report → export_changes → errors → END
                                                 (cap 1)     (cap 6)   (0032/D6)     (cap 9,      (cap 7)                     (cap 8)      (step 18¾ —      (errors.logs)
                                                                                     pending)                                              final_applied_
                                                                                                                                           changes/)
```

The `(diagnose)` node (dashed = documented, **not yet compiled** — see the header note and step 16½)
would sit between `changelog` and `remediation_report`: it reads the broken/blocked `validations` and the
failing stage logs, emits `diagnostics` (reason-for-broken + resolution per outcome), and
`remediation_report` / `html_report` render that alongside the ledger. Every node/edge count in this
doc still describes the committed graph **without** it.

**Step 1 is a wizard-time gate, not a compiled node** (change record `0024`/A3). The graph starts at
`health` (step 1¾ — the run-scoped service probe, plan `run-health-and-errors-log` Epic 01), then
`ingest` (step 2); the **session** step runs before compilation, in `src/steps/session.mjs`, and only
seeds the `.harness/<SESSION_ID>/` root every stage below writes into. It is the one numbered step
with no entry in this diagram — the node/edge counts above are unchanged by it.

**One `edges.switch`, at `dataset_init`** (`sdk/src/atoms/edges/switch.mjs`, change record `0023`/A2).
The two **repo-source** ingest lanes (`local_repo` / `remote_repo`) synthesize their dataset from a
single repo reference — the array `[{repo, repo_url}]` — so there is no spreadsheet and no header
subset to pick. They **skip step 3's `select_headers`** and go straight to step 4 (`collect_repos`).
`dataset_init` itself stays on every path: it is the spine seeder `collect_repos` reads, not a header
step. The `default` case keeps every other lane on the committed chain.

**Two graph-parallel regions, both Send-API fan-outs.** The clone edge
`{ from: fan, fanout: { over: repos, to: clone_repo }, then: fingerprint }` compiles to the langgraph
**Send API** (`sdk/src/atoms/edges/fanout.mjs`): `fan` (`nodes.fanout`) dispatches one
`Send(clone_repo, { repos_item, repos_index })` per repo, the branches write `clone_results` (concat),
and they **join** at `fingerprint`. The step-12 edge
`{ from: depgraph_fan, fanout: { over: fingerprints, to: dependency_graph }, then: depgraph_report }`
does the same over the fingerprints — one `Send(dependency_graph, { fingerprints_item,
fingerprints_index })` per repo, branches write `dependency_graphs` (concat), joining at
`depgraph_report`.

**Steps 7–11, 13–14, the capability stages, `resolve_datasource`, and `remediate` are single nodes,
not graph fan-out.** `fingerprint`, `resolve_datasource`, `integrate`, `plan`, `apply_rules`,
`optimize`, `remediate`, `snapshot`, `install`, `install_verify`, `build`, `build_snapshot`,
`run_test`, `validate`, `changelog`, `remediation_report`, and `html_report` each
run **once** and **loop internally** over
the joined per-repo arrays (`clone_results` / `fingerprints` / `integrated` / `installs` / `plans` /
`validations`). The `preflight` node (`0063`/A2) is also a single node but loops over nothing — it
probes each in-play registry lane once and publishes the run-scoped `registry_preflight` fact. A
per-repo _subgraph_ alternative
for that whole `clone → fingerprint → integrate → snapshot` stretch is recorded but **not adopted**
(change record `0016`/D1).

**`nodes.subgraph` is adopted in exactly two places** (`sdk/src/atoms/nodes/subgraph.mjs`):
`ingest` (step 2) and `dependency_graph` (step 12). Step 12's is fanned out — each branch embeds
`configs/flows/dependency-graph.yaml` as its own subgraph instance (`0017`/D1), narrowly, only for
dependency-graph extraction (`map_in: { fingerprint_item ← fingerprints_item }`,
`map_out: { dependency_graphs ← dependency_graph_item }`). Step 2's is a **single, non-fanned
orchestrator**: it embeds `configs/flows/ingest.yaml` once (`map_in: { ingest_source ← ingest_source,
ingest_ref ← ingest_ref }`, `map_out: { rows ← rows }`), and that child's `nodes.router` +
`edges.switch` dispatch to one lane per ingest source (`0021`/A1+D1).

## Steps

1. **session** (`src/steps/session.mjs` + `src/session-lib.mjs`; change record `0024`/A2+D1) — a
   **wizard-time gate, not a compiled node** (see `## Topology`). Every `make start` run either mints a
   fresh `randomUUID()` or resumes a session id the user supplies, and **every artifact the run writes
   lands under `.harness/<SESSION_ID>/`** — `repos/`, `snapshots/` (phase sub-dirs `initial/`,
   `build/` — `0029`/A1), `dependency-graphs/`, and each JSON/HTML report
   (the python venvs live inside each clone since `0026`/A4, so they ride along
   under `repos/`). `.harness/` stops being the artifact root and becomes the **container of
   sessions**, so two consecutive runs no longer overwrite each other in place. Scoping the clones is
   also the **resume** mechanism: re-entering an existing id finds them on disk and step 6's
   `on_exist: skip` makes the clone stage a no-op rather than a re-clone.
   Within the session dir the **pack keeps a `.harness` of its own** (`0048`; `src/session-lib.mjs`
   `packRenderDirIn`) — written below as **`<PACK>`** = `.harness/<SESSION_ID>/langgraph-harness-integration/.harness`.
   The split is by **owner**: the session root holds what a run learns about the **repos** (clones,
   snapshots, fingerprints, dependency graphs, the JSON/HTML deliverables a user is meant to find);
   `<PACK>` holds what only this pack writes and reads back — `decision.jsonl`, `reports/`, and the
   three raw-log roots of the playbook-driven stages, `installs/`, `builds/`, and `tests/`
   (`0053`/A1+A2 moved the first two here, so one artifact class no longer straddles two roots).
   The id is a **canonical UUID only** — it is concatenated into a filesystem path, so the grammar
   (no `/`, `\`, or `.`) is the **path-traversal guard**, the filesystem analogue of security rule §4's
   argv-list discipline; a typo'd resume re-asks rather than silently minting a new id. A supplied
   `runWizard(…, { sessionId })` / `$HARNESS_SESSION_ID` skips both prompts (`0024`/D2) — the seam the
   offline verify gate uses to pin one directory and assert inside it. The id is a run selector, not a
   credential (security rule §5 is not engaged), and is safe to print in the confirm gate and logs.

1¾. **health** (`commands.serviceHealth`; plan `run-health-and-errors-log` Epic 01) — the graph's
   **entry node**: probe the services the run depends on ONCE, before the first repo is cloned, and
   publish `service_health` (`{ ok, services: [{ id, kind, status, detail, remedy, evidence }] }`).
   The probed set is **declarative** — `harness.config.json`'s `services:` array, defaulting to
   `[docker, verdaccio, devpi]`; the strategies are a closed set (`docker` = argv `["docker","info"]`,
   `registry` = delegates to `src/registry-preflight.mjs`'s endpoint resolution + origin probe,
   `http`, `port`) so adding a service is a config entry, never an atom edit (`src/service-health.mjs`).
   A degraded environment emits one `loop.guard` (`kind: "service-health"`) that `run-flow` prints
   immediately — "Docker is not running" appears at the TOP of the run, not only in the errors ledger
   at the end. Reporting only: gating stays with step 9½'s lane-level `registry_preflight` guard.
   Never throws (an exploding probe is `status: "unknown"`); each probe individually bounded by
   `timeoutMs`. Under `--mock`: one deterministic placeholder, no subprocess, NO socket.
2. **ingest** (`nodes.subgraph` embedding `configs/flows/ingest.yaml`; change record `0021`/A1+D1) —
   an **orchestrator**, not a fixed file reader. Straight after the session gate the wizard asks *what*
   is being ingested (`src/steps/ingest-source.mjs`) and seeds `ingest_source` + `ingest_ref`; the child flow's
   `nodes.router` reads `ingest_source` and an `edges.switch` **maps it to the right lane**:
   - `local_csv` → `ingest_local` (`commands.harnessIngest`, `path_from: ingest_ref`) — unchanged behavior;
   - `remote_csv` → `fetch_csv` → `sanitize_csv` → `ingest_remote` (`commands.httpFetch` with explicit
     `timeout_ms: 15000` / `max_bytes: 2097152` → `commands.sanitizeUntrusted` → `commands.harnessIngest`
     parsing the neutralized bytes in memory via `content_from`, `0021`/D2). The sanitizer is **not
     optional**: security rule §1 makes an unsanitized path from `commands.httpFetch` to a `skills.*`
     node (`integrate`, downstream) a blocker, and §2 turns embedded directives into `major` findings
     on `fetch_findings`. Under `--mock` the fetch atom's body (`[mock http] GET <url>`) is not
     parseable CSV, so the lane short-circuits to a committed fixture via `mock_path` (`0021`/D5.6);
   - `local_repo` / `remote_repo` → `commands.repoRowSynthesize` (`0021`/D3) — one repo becomes a
     **single row of CSV** `{ repo, repo_url }`, i.e. the dataset is the single array `[remote_repo]`.
     The `local` kind reads `origin` via an argv-list `git -C <dir> remote get-url origin` (security
     rule §4); no `origin` yields `repo_url: null` plus a diagnostic on `error_logs`, never a silent
     zero-repo run. These lanes are **not scan-only** (`0023`/A1, correcting `0021`/A5): the absent
     `package` / `recommended_version` columns are a *routing signal*, not a dead end — the lane
     **skips step 3** (`0023`/A2) and `remediate` takes the repo's own extracted dependencies as its
     bump candidates, resolving each target from the registry;
   - `preset_list` / `dependabot` → `commands.ingestPreset` / `commands.ingestDependabot` —
     **placeholders** returning zero rows (`0021`/D4). When the Dependabot lane becomes real it must
     use native `gh api /repos/{owner}/{repo}/dependabot/alerts` (argv-list, no MCP connector, no
     service-account token — security rule §3);
   - anything else → `fail_unknown` (`commands.ingestUnknownSource`), which **throws**. An unknown
     ingest source must never yield an empty dataset that looks like a clean run.

   Every lane writes `rows`; the parent harvests it via `map_out`. The parent's node params
   (`config`, `map_in`, `map_out`) are **constant across all six selections** — the child flow, not the
   user, fixes each lane's atom params — so no selection can emit a structurally invalid `nodes[0]`
   (the invariant record `0001`/A1 was written to protect, retained as an acceptance criterion).
3. **dataset_init → select_headers** (`commands.datasetInit`, `commands.selectHeaders`) — seed the
   `dataset` spine, keeping **all** `original_headers` for reference, and let the user pick the
   working `selected_headers` subset (`repo`, `repo_url`, `package`, `severity`,
   `recommended_version`) for the remediation process.
   **Skipped by the two repo-source lanes** (`0023`/A2). `dataset_init`'s `edges.switch` on
   `ingest_source` routes `local_repo` / `remote_repo` **straight to step 4** — their dataset is the
   single array `[{repo, repo_url}]`, and a two-column synthesized row has no header subset to select.
   `dataset_init` still runs on that path (`collect_repos` reads the spine it seeds); only
   `select_headers` is bypassed.
4. **collect_repos → identify repo column** (`commands.collectRepos`) — prompt for / confirm the
   repo-URL column (`repo_column`, `repo_url`).
5. **collect_repos → dedup** — normalize + dedup the repo-URL column into `dataset.repos` (and the
   flat `repos` channel) — no duplicate clones.
6. **fan ⇒ clone_repo** (`nodes.fanout` + `edges.fanout` Send, `commands.gitCloneClassified`; change
   record `0019`/A1) — fan out over `repos`, cloning each repo to `.harness/<SESSION_ID>/repos/<slug>`
   (`on_exist: skip`); branches join at step 7. Clone failures are classified (`transient` retries
   bounded by `max_attempts: 3`; `auth_required` / `not_found` / `unknown` never retry) and RECORDED
   as `{ failed: true, errorClass, … }` data — one bad URL never aborts a fan-out branch, and the
   class stays legible through the fingerprints/integrated/report artifacts (`cloneError`).
7. **fingerprint → fingerprint_report** (`commands.repoFingerprint`, `commands.renderReport`) —
   detect each clone's fingerprint over `clone_results` → write `.harness/<SESSION_ID>/fingerprints.json`.

7½. **resolve_datasource** (`commands.resolveDatasource`, pure core `src/datasource-resolve.mjs`;
   change record `0065`/D1) — the **field-resolution seam**, between `fingerprint_report` and
   `integrate`. `dependency_scope` and `manifest_path` are **optional input columns**; this stage
   resolves them ONCE, against the clone on disk, and re-stamps `dataset.rows` with the resolved
   values plus their provenance, so `plan`, `apply_rules`, `remediate`, and contract C1 all read the
   same answer and cannot disagree. The governing principle:

   > **Provided wins. Absent derives. Underivable blocks — it never guesses.**

   Per row: a **provided `manifest_path`** is taken verbatim and never second-guessed (a manifest that
   does not declare the package is a **dataset contradiction** and must survive to C1, not be quietly
   repaired here); an **absent** one derives from a bounded recursive manifest read — the manifest(s)
   that actually DECLARE the package (`src/manifest-deps.mjs`). Declared in **none** ⇒ the row is
   resolved **transitive** and no manifest is needed (the pin writer owns its own target file);
   declared in **several** ⇒ the row **fans out**, one resolved row per declaring manifest (a genuine
   multi-module repo — the Dependabot CSV can only name one `manifest_path` per finding and so
   silently under-remediates it). A **provided `dependency_scope`** is authoritative; an absent one is
   derived from the above (declared ⇒ `direct`, declared-nowhere ⇒ `transitive`); an **underivable**
   one (clone failed, no readable manifest) resolves to `null` + `unresolved` and **blocks** the row
   downstream — it is never silently direct-bumped.
   That silent direct-bump WAS the `0065` bug: `strategyFor` collapsed a null scope into `direct-bump`,
   whose lane then demanded a manifest declaration that a transitive dependency by definition cannot
   have — 6 of 12 findings skipped, with C1 reporting the pipeline's own missing inference as a
   *dataset* violation. It is a **stage, not an inference inside `remediate`**, because `plan` runs
   first and already branches on strategy: inferring later would leave the PLAN — the artifact a human
   reads, and the one `0032` made authoritative — still carrying the wrong strategy. Decisions land on
   `<PACK>/decision.jsonl`. The same pure `resolveRow` core is reused by `buildRemediationPlan`
   against the fingerprint's `dependencies`, so a plan built WITHOUT the stage (unit tests, other
   flows) resolves identically — one implementation, two callers, no drift. Under `--mock`: a pure
   deterministic pass-through (supplied values kept, provenance stamped `mock`), no
   fs/subprocess/network. Node id is `resolve_datasource`, **not** `dataset` — LangGraph forbids a node
   named after a channel (the same constraint that named `preflight` beside `registry_preflight`, and
   `health` beside `service_health`).
8. **integrate → integrate_report** (`skills.detectSetup`, via the `ctx.llm` seam;
   `commands.renderReport`) — LLM-scan each fingerprinted repo to auto-detect how to setup / install
   / run / test it → write `.harness/<SESSION_ID>/integrated.json`.
   **plan** (`commands.remediationPlan`; langgraph-flow.md **capability 4a**) — the deterministic
   per-repo remediation PLAN, inserted between `integrate_report` and `optimize`. It joins each repo's
   **captured** evidence (the fingerprint + its extracted `dependencies[]`) with the **inputted**
   vulnerability data (the dataset rows matched to that repo by `repo_url`) into a stable, ordered
   `plans[]`: `{ repo, ecosystem, vulnerabilities[], actions[], notes[], tools[], skill }`. Each action
   names the package, target version (dataset `recommended_version` first, `first_patched_version`
   fallback), the **strategy** (`direct-bump` vs `transitive-pin`, from the row's **resolved**
   `dependency_scope` — step 7½, `0065`/D1), and the **language-specific tool** selected from the
   central **tool registry**
   (`harness-repo-package-remediation/tools/`, capability 2) by capability + manifest match; the referenced **skill** comes from
   the central **skill registry** (`harness-repo-package-remediation/skills/`, capability 3). Pure + deterministic (join +
   selection only — `src/remediation-plan-lib.mjs`), so it behaves identically under `--mock`: the
   dataset IS the vulnerability data, so the plan carries real CVEs/packages/targets even offline.
   **apply_rules** (`commands.applyPackageRules`; change record `0032`/D5) — the package-rules
   policy stage between `plan` and `optimize`: it stamps each plan action with its policy verdict +
   `rangeStrategy` (the declarative package-rules config) into `plans_ruled` — the decided-actions
   channel `remediate` executes — BEFORE the mutating stage runs. Pure + deterministic.
   **optimize** (`skills.optimizePrompt`; **capability 4b**) — the LLM prompt optimizer, between
   `apply_rules` and `remediate`. It has the model REVIEW each plan (via the `ctx.llm` seam) and emit an OPTIMIZED
   remediation `prompt` for the SDK agent, seeding the model's SYSTEM prompt with the plan's referenced
   SKILL body (the reusable instruction the SDK loads from `harness-repo-package-remediation/skills/`). Mock / mock-provider →
   a deterministic prompt CONSTRUCTED from the plan (`source: "deterministic"`); a real model reply is
   used verbatim (`source: "llm"`); an unusable real reply degrades to the constructed prompt with a
   recorded finding — the same mock/degrade discipline as `skills.detectSetup`.
   **remediate** (`commands.repoRemediate`; change records `0019`/A3+D2, `0023`/A1; now EXECUTES the
   plan — **capability 5**) — the pipeline's
   first **mutating** stage, between `optimize` and `snapshot`. The **candidate set is chosen
   by the dataset's shape**, not by any per-row test:
   - **spreadsheet ingest** (a `package` column exists) — join each repo's extracted
     `fingerprints[].dependencies` against the dataset rows' `package` / `recommended_version`
     columns; the target is the spreadsheet's, with an npm-registry-lookup **fallback**;
   - **repo-source ingest** (`local_repo` / `remote_repo` — the dataset is the single array
     `[{repo, repo_url}]`, so there is **no** `package` column at all) — every dependency the
     fingerprint stage extracted is a candidate (deduped by name), and **every target comes from the
     registry** (`source: "registry"`). The lane **remediates**; `0021`/A5 called it scan-only, and
     `0023`/A1 retracts that.

   Either way each registry `Release` carries `releaseTimestamp` for future cooldown gating, each
   candidate is gated through the declarative policy at `configs/policy/remediation-policy.yaml`
   (`0019`/D3) **before any edit**, and the declared version is bumped in `package.json` **in place**
   (formatting-preserving single-token edit, atomic write). Every candidate yields a `remediations[]`
   record `{ repo, package, from, to, source, releaseTimestamp, applied, skipReason }` — skips
   (policy-filtered, unsupported syntax, no bump support, clone failed, a **blank `package` cell** in a
   dataset that has the column, or **no dependencies extracted** from a repo-source repo) are recorded,
   never silently dropped. Mock → deterministic stub records, zero fs/HTTP. npm-only; no lockfile regen,
   no PRs (deferred). Runs **before** snapshot so the inventories (and steps 10 and 12's real-run
   install/depgraph commands) reflect post-bump state. **Capability 5**: with `plans_from: plans_ruled`
   set, each remediation record is stamped with the matching plan action's `strategy`/`tool` (`planned:
   true`) — additive provenance that traces the executed edit back to the plan without changing the
   candidate logic.
9. **snapshot** (`commands.repoSnapshot`, engine `vendors/tools-repo-filesystem-snapshots`) —
   snapshot each clone's tracked filesystem → write one
   `.harness/<SESSION_ID>/snapshots/initial/<reponame>.repo.json` inventory per repo
   (`name_suffix: repo.json`; basename → paths map + collision index). Phase-namespaced
   **`initial`** (`0029`/A1): the snapshot seam carries a `namespace` param (`label` alias) that
   both stamps the document (`"namespace": "initial"`) and lands the artifact under the
   `snapshots/<namespace>/` sub-dir, so this pre-install, post-remediate inventory coexists with —
   and diffs pairwise against — step 14's post-build re-snapshot.

9½. **preflight** (`commands.registryPreflight`; change record `0063`/A2, completing `0054`/D1) —
   the once-per-run **registry reachability probe**, between `snapshot` and `install`. It resolves
   each in-play lane's CONFIGURED endpoint (`npm config get registry`, `pip config get
   global.index-url` — from a neutral cwd; never a hard-coded constant), probes the endpoint's
   ORIGIN once (~0.1 s for a refused connect), and publishes the run-scoped `registry_preflight`
   fact that `install`, `build`, and `run_test` all consume via `preflight_from`. `0054` computed
   this inside `install-run`, where the result died; `build-run` then walked into the same dead
   registry and reported a **red build** for an environmental outage (`python3 -m build`
   pip-installs its PEP-517 `build-system.requires` from the index — a TRANSITIVE consumer
   `laneForArgv` now recognizes, `0063`/A3). A dead lane makes each consumer skip its gated steps
   (`skipped: "registry-unreachable"`, `cause: "environment"` → the repo is **blocked**, never
   `broken` — and, `0063`/A1, never `ok` on the strength of the ungated steps alone). On failure it
   reports loudly (start Docker + Verdaccio `:4873` / devpi `:3141`) and **never reroutes to a
   public registry** (the local Verdaccio is load-bearing — `@harness/core` exists only there).
   Only the lanes actually in play are probed; a maven-only run summons no probe. Mock → one
   deterministic placeholder fact, no socket.
10. **install** (`commands.installRun`, playbooks under
   `configs/playbooks/ecosystem-installation/`; change record `0026`) — loop over the integrated
   repos, resolve each repo's **install locations** (`integrated[].modules` — `{dir, manifest,
   ecosystem}` entries derived across **all** ecosystems the fingerprint records plus `subRepos[]`,
   `0026`/A2+D3) and run the matching **declarative per-ecosystem installation playbook** at each
   location (one directory per `ECOSYSTEM_GROUPS` key; toolchains nested per `detectToolchain`).
   The **ordering is load-bearing**: after `snapshot` (installing writes `node_modules/`, `target/`,
   `.venv` into the clone — the `0025`/A2 hazard class — so the snapshots keep inventorying the
   pre-install, post-remediate tree) and before `depgraph_fan` (step 12's `npm list` / `pipdeptree` /
   `deptry` are only meaningful against an installed tree). `integrated[].install` — the LLM's
   detected shell strings — is **evidence, never executed** (`0026`/A3; security rules §1/§2/§4): a
   divergence between that evidence and the playbook argv is recorded as an informational finding.
   Playbook steps are argv lists with `guard` CLI probes (absent → recorded skip), bounded timeouts
   (default 600 s), per-repo location cap (`max_locations` 25, truncation recorded), and exit-code
   honesty (`0025`/A1): each step record carries `{ tool, location, argv, artifact, exitCode, ok }`,
   raw stdout lands in `<PACK>/installs/<repo>/[<location-slug>/]<step>.log` (+
   `.stderr.txt` sibling), and the per-repo result carries `status` (`ok` | `failed` | `skipped`).
   The python playbook provisions the repo's own `<clone>/.venv` (`0026`/A4); `docker`/`other` are
   explicit no-ops with a stated reason; no playbook for an ecosystem → `skipped: "no-playbook"`,
   never a silent success. A repo-specific installation definition is a **deferred tier 1**
   (`0026`/D4) — today every location falls through to its ecosystem playbook.
   **Fail fast, don't pay the toll** (`0054` → `0063`): repos install under a bounded concurrency
   pool (`concurrency: 4`); registry-touching children get a bounded retry budget
   (`fetch_retries`/`fetch_retry_max_ms`); a per-cause circuit breaker (`fail_fast_after: 3`)
   short-circuits the stage on consecutive identical faults; and the step-9½ `registry_preflight`
   fact (consumed via `preflight_from`; the inline probe remains the fallback for a bare stage)
   gates every step whose argv reaches a registry — a dead lane records
   `skipped: "registry-unreachable"`, `cause: "environment"`. `0063`/A1: a guard-skipped step is
   **stage-invalidating** — the repo verdict is never `ok` on the strength of the ungated steps
   (the venv-create false positive, `0034`/A1, closed via the guard door too). Mock → one
   deterministic per-repo stub, no fs/subprocess/network.
11. **install_verify** (`commands.installVerify`; change record `0027`/A1+D1) — assert step 10 actually
   **produced output**, not just that its commands returned 0. Between `install` and `depgraph_fan`,
   loop over the `installs` records and, per repo and per **executed** install location (a step with a
   recorded `exitCode`), make two **read-only** assertions: (1) the ecosystem's expected **package
   directory** is present and non-empty — `<location>/node_modules` (node), the per-location
   `<location>/.venv` (python; the venv `install` writes per `0026`/A4), `<location>/target` (java,
   best-effort — a shared `~/.m2` cache is recorded `indeterminate`, never a failure; `golang`/`docker`/
   `other` carry no package-dir contract and are likewise `indeterminate`), recorded with its entry
   count; and (2) every recorded step **log** at `<PACK>/installs/<repo>/[<location-slug>/]<step>.log`
   **exists and is byte-size > 0**, noting the `<artifact>.stderr.txt` sibling (`0025`/D1). Per-location
   `ok` = package dir present & non-empty (or indeterminate) **and** every expected log present &
   non-empty; per-repo `status` ∈ `ok` | `failed` | `skipped` (`skipped` when the install record was
   itself a mock stub / clone-failed / no-playbook skip — verification is then vacuous). The stage is
   **read-only and NON-GATING** (`0027`/A1): an empty package dir or a missing/zero-byte log is a
   **recorded `failed` finding**, never an exception and never a pipeline abort — `depgraph_fan` still
   runs, now with evidence of whether the tree step 12 inventories was actually populated (an empty
   `node_modules`/`.venv`/`target` would make `npm list` / `pipdeptree` / `deptry` silently
   under-report). The atom **never throws**. Mock → one deterministic per-repo stub, no
   fs/subprocess/network.
12. **depgraph_fan ⇒ dependency_graph → depgraph_report** (`nodes.fanout` + `nodes.subgraph` embedding
   `configs/flows/dependency-graph.yaml`, `commands.renderReport`; change records `0017` → `0018` →
   `0019`) — a **sub-langgraph** fanned out over the step-7 fingerprints (one `Send` per repo). Each
   per-repo subgraph instance's `nodes.router` reads the repo's detected `dominantEcosystem` and an
   `edges.switch` **maps it to the right extractor node** — one lane per supported language group:
   **Java** (maven, gradle), **python** (pip, poetry, uv), **node** (ts, mjs), **docker**, **golang**
   — with an `other` default so an undetected / mock-stub fingerprint routes cleanly. The router
   branches at ecosystem-group level; each lane's extractor (`commands.depgraphExtract`) sub-detects
   the exact toolchain via the consolidated `src/ecosystem-registry.mjs` (`0019`/A4). Under `--mock`
   (default) every lane is a pure, offline state transform returning the deterministic stub
   `{ placeholder: true, ecosystem, toolchain, repo, url, dir, dominantEcosystem, nodes: [], edges: [] }`
   — the acceptance contract holds byte-for-byte. On **real (`MOCK=false`) runs** (`0018`) the python
   lane first provisions an isolated **per-repo tooling venv** at `<clone>/.venv-deptry`
   (`commands.venvSetup` with `clone_from: fingerprint_item`, installs `deptry` + `pipdeptree`;
   `0026`/A4 supersedes `0018`/D1's run-global `<session>/.venv` — a shared venv would poison every
   later repo's `pipdeptree` view once step 10 installs repo dependencies; `0020`/A2's serialization
   survives as a cheap lock whose contention is gone), then each lane executes its per-ecosystem
   command matrix inside the repo clone — argv-list subprocesses, bounded timeouts, guarded
   **IF-clone-succeeded-AND-CLI-present-ELSE-SKIP** (`0019`/A1: failed clones record
   `{ skipped: "clone-failed", errorClass }` and run nothing):
   **node** `npm list --json` · lockfile copy · `npm outdated --json` · `knip` · `dependency-tree`;
   **python** `pip list` / `pip list --outdated` / `pip freeze` → `requirements.txt` · venv `deptry`
   (with an explicit `--extend-exclude` for the non-default `.venv-deptry` name — `0026`/A4) · venv
   `pipdeptree --json` (pointed via `--python` at the step-10 install venv `<clone>/.venv` when it
   exists, so the enumerated closure is the repo's, not the tooling pair's);
   **java** `mvn -f <module> dependency:tree -DoutputType=json` (`0025`/A2 —
   `dependency:analyze` compiles and creates a `target/` inside the clone, so it moved behind the
   off-by-default `maven_analyze` flag) or `./gradlew dependencies` (wrapper preferred, `gradle`
   fallback); **golang** `go list -u -m all` · `go mod graph`; **docker/other** keep the placeholder
   stub. The **maven** lane is module-aware (`0025`/A3): a repo with no root `pom.xml` runs one
   invocation per top-most `primary-manifest` the fingerprint recorded, capped by `max_modules`
   (default 25, and a truncation is recorded — never silent). Every command's raw stdout is saved to
   `$DEPGRAPH_SAVE_DIR/<repo>/[<module-slug>/]<tool>.<ext>` (default
   `.harness/<SESSION_ID>/dependency-graphs/`) with a `<artifact>.stderr.txt` sibling when stderr is
   non-empty (`0025`/D1), and the graph-yielding tools (`npm list --json`, `go mod graph`,
   `pipdeptree`, `mvn dependency:tree`) are additionally parsed into `{ nodes, edges }`. A non-zero
   exit is a **recorded outcome** (`0025`/A1): each command carries `ok`, and the per-repo result
   carries `status` (`ok` | `failed` | `skipped`) + `failed` — an empty graph from a `BUILD FAILURE`
   can no longer masquerade as a successful extraction. Per-repo results collect (concat) into
   `dependency_graphs` and `depgraph_report` writes the aggregate
   `.harness/<SESSION_ID>/dependency-graph.json`.
13. **build** (`commands.buildRun`, playbooks under `configs/playbooks/ecosystem-build/`; change
   record `0029`/D1) — loop over the integrated repos and run the matching **declarative
   per-ecosystem BUILD playbook** at each of the same `integrated[].modules` install locations step
   10 materialized — the install stage's machinery (guarded argv-list steps, bounded 600 s timeouts,
   `max_locations` 25 cap with recorded truncation, exit-code honesty `0025`/A1, evidence-only LLM
   authority boundary `0026`/A3), pointed at compile/package commands: **node**
   `npm run build --if-present` (a script-less repo is a clean no-op, not a failure); **java**
   `mvn -B package -DskipTests` or `./gradlew build -x test` (wrapper preferred, `gradle` fallback);
   **python** `python -m build` / `poetry build` / `uv build`; **golang** `go build ./...`;
   `docker`/`other` explicit no-ops with a stated reason; no playbook → `skipped: "no-playbook"`,
   never a silent success. Placed **after** the install/verify/depgraph chain (a build needs the
   installed tree) per the record's literal 13/14 numbering. Two `0063` guards keep a broken
   environment from surfacing as a red build: the stage consumes the step-9½ `registry_preflight`
   fact (`preflight_from`) and skips any step whose argv can CAUSE an index fetch — including the
   PEP-517 front `python -m build`, a transitive consumer (`0063`/A3) — when its lane is dead
   (`registry-unreachable`, cause `environment` → **blocked**); and the **hermetic-toolchain guard**
   (`0063`/D1) blocks a node module whose manifest declares dependencies but whose clone holds no
   `node_modules` (`toolchain-not-installed`, cause `environment`) instead of letting npm's
   ancestor bin-resolution silently borrow the HARNESS's own hoisted compiler (`ts-baseline` pins
   TS 5.3.3; the borrowed `tsc` 6.0.3 rejects its config with TS5107 — a "build failure" the repo's
   diff never caused). An installed module builds with its own `node_modules/.bin` first on the
   child's PATH. Raw stdout lands in
   `<PACK>/builds/<repo>/[<location-slug>/]<step>.log` (+ `.stderr.txt` sibling), and
   each per-repo `builds[]` record carries `status` (`ok` | `failed` | `skipped`) + `failed`. Mock →
   one deterministic per-repo stub, no fs/subprocess/network.
14. **build_snapshot** (`commands.repoSnapshot` again, `namespace: build`; change record `0029`/D2)
   — re-snapshot each clone's tracked filesystem **after the build** → one
   `.harness/<SESSION_ID>/snapshots/build/<reponame>.repo.json` per repo, into the distinct
   `build_snapshots` channel. The `0029`/A1 phase namespace keeps it from colliding with step 9's
   `snapshots/initial/` artifact and lets the run diff *initial → build* per repo. Note the tool's
   enumeration contract (`0009`/D4): `git ls-files` honors `.gitignore` (and the fs-walk fallback
   skips `dist`/`build`/`target`), so the diff surfaces **tracked** files the build produced or
   touched, not gitignored build output. Mock behavior is inherited from `commands.repoSnapshot`
   (deterministic representative stub, no fs read).
15. **run_test** (`commands.testRun`, playbooks under `configs/playbooks/ecosystem-test/`;
   langgraph-flow.md **capability 1** — "test it, if present") — a faithful MIRROR of `commands.buildRun`
   pointed at the per-ecosystem TEST playbooks, run at each `integrated[].modules` install location
   AFTER `build_snapshot` (a test needs the built tree). "If present" is honored per ecosystem — the
   node lane runs `npm run test --if-present`, so a test-less repo is a clean no-op, not a failure; the
   exit code is a RECORDED outcome (`0025`/A1), never an exception; `docker`/`other` are explicit
   no-ops. Like `build`, it consumes the step-9½ `registry_preflight` fact (`preflight_from`,
   `0063`/A2): a step whose lane is dead is a recorded `registry-unreachable` skip that invalidates
   the stage verdict (**blocked**, never `ok`, never `broken`). Raw stdout lands in
   `<PACK>/tests/<repo>/[<location-slug>/]<step>.log`, and
   each `tests[]` record carries `status` (`ok` | `failed` | `skipped`) + `failed`. Mock → one
   deterministic per-repo stub, no fs/subprocess/network.
16. **validate** (`commands.remediationValidate`; **capability 6** — "validate what was fixed, broken,
   bug, blocked, skipped") — CROSS-REFERENCES the `remediations` with the `install_verifications`,
   `builds`, and `tests` results and classifies each attempt, per repo and per package, into the
   five-category ledger: **fixed** (applied + no downstream failure), **broken** (applied + a
   downstream stage failed for a reason ATTRIBUTABLE to the edit — a dependency/version conflict — or
   for an unexplained reason), **blocked** (skipped for an external reason — clone failed, no bump
   support, a policy denial, an `unresolved` scope from step 7½ — OR applied but the only downstream
   failure has a BENIGN cause NOT the edit's fault: an environmental block or a pre-existing/toolchain
   break, `0033`), **skipped** (a
   benign no-op — already at target, unsupported syntax, mock), **bug** (a `manifest edit failed`
   skip, or a downstream failure with no applied remediation). The applied-edit disposition follows
   the causal chain install → build → test: the FIRST failed stage's `cause` (tagged by
   `install-verify` / `build-run` via `src/diagnose-lib.mjs`) decides, and later failures are its
   consequences. It also enforces **contract C1** (`0032`/D7) against the **resolved** `dataset`
   (step 7½): the datasource's `recommended_version` is a **minimum-apply obligation**, and a resolved
   version below that floor is an explicit finding + decision line — never a silent `fixed`.
   Each `validations[]` record carries `outcomes{}`, `packages[]`, `stages{}`, and an
   `overall` (`clean` | `attention` | `blocked` | `failed` | `noop`). Pure + NON-GATING (the
   install-verify discipline, `0027`/A1): it does no I/O, runs identically under `--mock`, and NEVER
   throws.

16½. **diagnose** (**capability 9** — "provide the reason for each broken outcome + how to possibly
   resolve"). The DETERMINISTIC CORE is **landed** (`0033`), realized INSIDE the existing nodes rather
   than as a separate LLM stage: `install-verify` and `build` read a failed step's captured output and
   tag `install_verifications[].cause` / `builds[].cause` via `src/diagnose-lib.mjs`
   (`environment` — a down registry / `ECONNREFUSED` to `localhost:4873`/`3141`; `toolchain` — a
   pre-existing `tsc` TS5107 break; `lockfile-drift` — npm ci `EUSAGE`; `dependency-conflict` — the
   edit's own `ERESOLVE`/peer clash), and `validate` (step 16) consumes those causes to disposition
   **blocked** vs **broken**. So a broken outcome the harness did NOT cause is now legible as
   **blocked**, not read as a bad bump — no separate node, no LLM, offline-safe, pure. The single-page
   report (step 18) surfaces a **pass rate** = `fixed ÷ (fixed + broken + bug)` (decided outcomes only;
   blocked/skipped excluded so a Docker outage can never depress the remediation score), plus each
   card's `cause`. Proven end-to-end by `test/remediation002-matrix.test.mjs`. What remains **pending
   compilation** is only the OPTIONAL LLM-authored human-readable narrative — a `skills.diagnoseBroken`
   node (`ctx.llm` seam) emitting `diagnostics[]` `{ repo, package, stage, reasonForBroken,
   likelyRootCause, suggestedResolution, class, confidence }` for prose next to each card. **Wiring
   debt (narrative only):** add the `diagnose` node to `configs/flows/repo-remediation.yaml`
   (`reads: [validations, installs, install_verifications, builds, tests]`, `writes: [diagnostics]`),
   a `skills.diagnoseBroken` pattern under `configs/patterns/`, a `diagnostics` channel, and
   regenerate this doc (→ 33 nodes / 36 edges). Topology today is unchanged — the diagnosis lives
   inside `install-verify` / `build` / `validate`.

   > **Run `5cc983f3…` diagnostics (the insight this stage produces for the 10 broken outcomes).**
   > None of the 10 was a wrong edit — all 12 manifest bumps applied correctly; the breakage is
   > downstream. Four classes (full evidence in
   > `.ai/harness-repo-remediation/analysis/remediation002/findings/`). **As of `0033` the pipeline
   > now acts on these automatically:** `environment` + `repo-side`/`pipeline-gap` → **blocked** (via
   > the `install_verifications[].cause` / `builds[].cause` tags), and `scoring-artifact` → **fixed**
   > (the `install-verify` recovered-primary skip + exit-code honesty). Re-scoring the same evidence
   > yields **5 fixed / 0 broken / 7 blocked — 100% pass rate**:
   >
   > | class | reason for broken | how to resolve | repos |
   > |-------|-------------------|----------------|-------|
   > | **environment** (dominant) | npm Verdaccio `:4873` + pip devpi `:3141` refuse connections (Docker off) — any fetch of an uncached version, transitive closure, or PEP517 build env dies (`ECONNREFUSED` / "No matching distribution"). Java escaped via `~/.m2` + Maven Central. | Start Docker + both registries; cache the patched versions **and** their closures; fail-fast probe `lsof -ti tcp:4873`/`:3141` + `docker info`; classify registry-down as **blocked**, not **broken**. | root-upgrade-npm, override-transitive-npm, root-upgrade-pip, override-transitive-pip, batch-jsonl-pip, ts-baseline-multi-dep |
   > | **pipeline-gap** | `remediate` edits `package.json` (overrides/bump) but never regenerates `package-lock.json` → `npm ci` fails EUSAGE ("lock file's follow-redirects@1.13.3 does not satisfy 1.15.6"). | After the edit, re-sync the lock: `npm install --package-lock-only`. | root-upgrade-npm, override-transitive-npm |
   > | **scoring-artifact** | Repo ships no lockfile → primary `npm ci` fails (0-byte stdout log) but `npm install` fallback succeeds (correct `node_modules`); `install-verify.mjs:219` still demands every step's stdout log be >0 bytes → false **failed**. | Don't require a stdout log for a `fallback`-superseded step (accept the `.stderr.txt` sibling); or guard `npm ci` on `package-lock.json` presence. | batch-csv-npm, multi-repo-npm |
   > | **repo-side** | `tsc` TS5107: repo's `moduleResolution=node10` deprecated by installed TypeScript 7.x — pre-existing, not a regression. | Repo-side: `"ignoreDeprecations": "6.0"` or `moduleResolution: "bundler"`/`"node16"`; pin TS <7. | ts-baseline-multi-dep |

16¾. **changelog** (`commands.fetchChangelogs`; change record `0032`/D6) — the changelog tail
   stage between `validate` and `remediation_report`: for each APPLIED remediation it resolves the
   release range and a source/compare URL into `changelogs[]`, so the reports can link "what
   changed between `from` and `to`". Guarded and offline-safe: under `--mock` (and without network)
   it records deterministic stubs, never a fetch.

17. **remediation_report** (`commands.remediationReport`; **capability 7** — "generate remediation
   reports") — joins the plan, optimized prompt, executed remediations, and outcome classification
   per repo into one **markdown report per repo** under
   `<PACK>/reports/<repo>.md` plus an aggregate
   `<PACK>/remediation-report.json`, and writes the `remediation_summary` channel
   (`{ reports[], aggregate, totals }`). Deterministic; respects `ctx.options.dryRun`; writes under
   `--mock` because the reports ARE the deliverable.

**render** (`commands.renderReport`) — emit the deterministic run summary (picking `dataset`,
`clone_results`, `plans`, `optimized_prompts`, `remediations`, `snapshots`, `installs`,
`install_verifications`, `dependency_graphs`, `builds`, `tests`, `build_snapshots`, `validations`,
`changelogs`, and — once `diagnose` is compiled — `diagnostics`) to `.runs/out/repo-remediation.json`.

18. **html_report** (`commands.renderHtmlReport`; **capability 8** — "based on all generated report
   artifacts generate a single HTML report that explains the outcome"). It reads
   every pipeline channel — including `service_health`, from which the generator's data layer stamps
   the `environment` fact behind the report's **environment banner** (plan `run-health-and-errors-log`
   Epic 03: when a down service blocked outcomes, the page says so above both views, remedy first, so
   a report read in isolation cannot be mistaken for a verdict on the code) — and renders ONE
   self-contained HTML document (inline CSS, no external assets,
   every external value HTML-ESCAPED per security rules §1/§2 — the "Modern Minimalist" theme) via the
   pure `src/html-report-lib.mjs`: a summary dashboard (repos / vulnerabilities / actions /
   fixed·broken·blocked·skipped·bug), a per-capability pipeline list, and one per-repo card
   (vulnerabilities, deterministic plan, optimized SDK prompt, remediation results, outcome ledger,
   stage results — and, once `diagnose` (capability 9) is compiled, the per-broken-outcome
   **reason + suggested resolution** from `diagnostics`). Writes `.runs/out/repo-remediation.html`.
   Deterministic; respects `dryRun`; writes under `--mock`.

18¾. **export_changes** (`commands.exportAppliedChanges`, pure core `src/final-changes-lib.mjs`) —
   the **final CONTENT stage**, between `html_report` and `errors`. Every artifact before it
   DESCRIBES the change (`remediations[]` says a bump applied; the reports say it was `fixed`); the
   changed BYTES live only in `<session>/repos/<slug>`, a tree a resumed run's `on_exist: skip`
   never rewrites and a fresh session id never produces again. This stage lifts the run's PRODUCT
   out of that disposable clone tree into `.harness/<SESSION_ID>/final_applied_changes/`:

   ```
   final_applied_changes/
     manifest.json                       ← aggregate index: every repo, totals, per-repo evidence
     <repo-slug>/
       repo-metadata.json                ← identity, applied edits, outcomes, the file ledger
       changes/<repo/relative/path>      ← the COMPLETE post-remediation file (not a diff)
       original/<repo/relative/path>     ← its HEAD baseline, so the export diffs without the clone
       changes.patch                     ← `git diff HEAD`, when the scan ran
   ```

   **Two evidence sources, UNIONED — never one or the other.** (1) The **git scan** of each clone
   (`git status --porcelain -z`, argv-list, bounded) is AUTHORITATIVE: it sees changes no record
   names — the `package-lock.json` npm rewrote during step 10, the second file a transitive-pin
   writer touched. (2) The **recorded applied changes** (`remediations[]` where `applied`, each
   naming its `manifest` / `pinnedIn`) are the INTENT: they survive a failed clone, an absent git,
   and a `--mock` run. Each file carries `evidence` ∈ `git` | `recorded` | `git+recorded`, and the
   **disagreement between the two is the signal, not noise**: a recorded edit git cannot see lands
   as `status: "recorded-only"` — the write did not land — and is never smoothed into success.
   Machine output is excluded (`node_modules/`, `.venv/`, `target/`, `dist/`, `*.egg-info/` — steps
   10/13 write those INTO the clone, the `0025`/A2 hazard class), so the export is the size of a
   patch, not of a dependency closure. Bounded per platform rule 4: `max_files` (200) and
   `max_file_bytes` (2 MiB), every truncation RECORDED. Paths from the dataset-borne records pass a
   traversal guard before they are concatenated into a destination (the filesystem analogue of
   security rule §4). **Non-gating**: a repo whose scan explodes is a recorded `status: "failed"`
   entry; the stage NEVER throws, and it sits BEFORE `errors` precisely so its own failure still
   reaches `errors.logs`. Mock → the artifacts are still written (they ARE the deliverable, the
   `remediation_report`/`html_report` rule) carrying the recorded intent plus an explicit
   `evidence.source`, with NO git subprocess and NO repo read — a mock export can never be mistaken
   for an observed one. Respects `dryRun` (computes the ledger, skips the writes). Session-rooted
   via the outputStep/flow-plan render seam (`finalChangesDir` → the `OVERLAYS` allowlist); like
   `errors`, the committed yaml deliberately carries NO `out_dir` on the node (a `../../` literal
   there is the `0043`/`0046` scatter vector).

19. **errors** (`commands.errorsConsolidate`; plan `run-health-and-errors-log` Epic 02) — the
   **terminal node**: after `export_changes`, when every channel is populated, consolidate every
   failure, skip, and environmental signal in the run into ONE cause-first file at the **session
   root** — `.harness/<SESSION_ID>/errors.logs`, a sibling of `repos/` and `fingerprints.json` (a
   run-wide fact, deliberately NOT under `<PACK>` — see the `0053` ownership note in
   `src/steps/output.mjs`). Grouped by ROOT CAUSE via the same `src/diagnose-lib.mjs` taxonomy the
   validate stage scores with (no second classifier); the verdict header leads with cause, blast
   radius, remedy, and — when zero code-attributable failures exist — the line that would have saved
   session `f9f30203`: *"Nothing in this run tells you anything about your diff."* Code-attributable
   groups always render FIRST (a regression never hides behind Docker). Every claim carries
   evidence (`<artifact>:<line>` from a bounded 64 KiB read); quoted output passes a redaction gate
   at write time (security rule §5/§6); the body is deterministic (golden-tested byte-for-byte).
   **Written on EVERY run** — a clean run gets an explicit "No errors recorded" body naming what was
   checked, and `--mock` writes it too — so an absent file means exactly one thing: the errors stage
   did not run (`0051`/A3 one stage later). Non-gating: an internal error writes what it has and
   returns normally. Publishes `errors_summary` (verdict + absolute path), which `run-flow` prints
   on exit (remedy, not symptom; exit 0 for clean/environmental-blocked, 1 for code-attributable —
   see `harness-repo-package-remediation/docs/env.md`), then `END`.

> Mock-first / offline: under `--mock` (default) no network, no key, no git, no LLM, and no
> filesystem mutation — **all six ingest lanes** run end-to-end, and both routes out of
> `dataset_init` are exercised (the remote-CSV lane short-circuits
> to a committed fixture, the local-repo lane returns a stub row rather than spawning `git`),
> clones yield `{ mocked: true }` fixtures, the LLM/snapshot stages return
> deterministic representative stubs, `resolve_datasource` is a pure pass-through that keeps supplied
> values and stamps provenance `mock` without reading a manifest (`0065`/D1),
> the remediate stage records stub remediations without
> touching any manifest, the `health` and `preflight` nodes each return a placeholder fact without
> spawning a process or opening a socket
> (`run-health-and-errors-log` Epic 01, `0063`/A2), the install + install_verify + build stages each return one placeholder
> stub per repo without running a single playbook step or `stat`ing a single path, the
> `export_changes` node writes `final_applied_changes/` from the RECORDED intent alone — no git, no
> repo read, and an `evidence.source` that says so — and the terminal
> `errors` node still writes `errors.logs` (the file's existence is never conditional on network —
> silence is not success). The pipeline is no
> longer detection-only: on real (`MOCK=false`)
> runs the remediate stage edits cloned repos' `package.json` in place (`0019`/A3+D2), the
> install stage writes `node_modules/` / `target/` / `.venv` into each clone (`0026`/A1 — after
> snapshot, deliberately), install_verify `stat`s those trees + the install logs to assert the
> install actually materialized dependencies (`0027`/A1 — read-only, non-gating), the build stage
> compiles/packages each installed tree (`0029`/D1 — `dist/`, `target/`, wheels), and build_snapshot
> re-inventories the tracked tree afterwards under `snapshots/build/` (`0029`/D2).
>
> The **capability stages** are mock-aware too: `plan` is pure (it joins the real dataset + fingerprint
> regardless of run mode, so its CVEs/targets are real even under `--mock`); `optimize` returns a
> deterministic constructed prompt under mock/mock-provider and only calls the model on a real run;
> `run_test` returns one per-repo stub under mock and runs the test playbooks (guarded, argv-list)
> only on real runs; `validate` is pure classification (identical in both modes); `diagnose`
(capability 9, pending compilation) mirrors `optimize` — a deterministic constructed diagnosis from
the ledger + log tails under mock/mock-provider, a real model reply only on a real run; and the `remediation_report`
> markdown/JSON and the single `html_report` page ARE the deliverable, so they are written under
> `--mock` (respecting only `dryRun`). The tool + skill registries (`harness-repo-package-remediation/tools/`, `harness-repo-package-remediation/skills/`,
> capabilities 2/3) are committed data loaded through the SDK seam, unchanged by run mode.
