# How `@harness/` extends the vendored **langgraph-harness** platform

> **Status:** analysis (Epic 02). Grounded entirely in the vendored mirror at
> `harness-repo-package-remediation/vendors/langgraph-harness/` (pinned upstream SHA `9caf8c58…`) and the `@harness/` monorepo at
> `harness-repo-package-remediation/`. Every seam below names an existing file. Nothing here is invented; nothing is
> modified inside the pristine mirror.

## 1. Summary & dependency-direction decision

**Decision: `@harness/` consumes / embeds langgraph-harness.** langgraph-harness is the **orchestration + reasoning** layer
(a `yaml → mapping → registry → execute` flow engine over LangChain/LangGraph); `@harness/` is a
**deterministic data source** (CSV/XLSX → normalized rows) that feeds it. The dependency points
**harness → langgraph-harness**: an integration package builds *on top of* the vendored platform by contributing
a custom `commands.*` atom, a config pack, and a flow — using only langgraph-harness's public seams.

Rejected alternatives:

- **(a) Merge langgraph-harness's four workspaces into harness's root `packages/*` workspace set.** This would
  entangle langgraph-harness's frozen LangChain pins (`@langchain/core` 1.1.48, `@langchain/langgraph` 1.3.4,
  `zod` 3.25.76, `yaml` 2.9.0) with harness's dependency tree and break `git subtree pull`
  cleanliness (the vendor would no longer be a pristine mirror). Rejected.
- **(b) Make langgraph-harness depend on `@harness/` upstream** (edit the source repo so langgraph-harness imports harness).
  We do not own or modify the source repo — projects are frozen references (platform rule 7), and
  the vendor stays a pristine mirror. Rejected.

The vendored langgraph-harness therefore stays an **independent install root** at `harness-repo-package-remediation/vendors/langgraph-harness/`,
outside harness's `packages/*` glob. Integration code lives in the **sibling** package
`harness-repo-package-remediation/vendors/langgraph-harness-integration/` (this directory), never inside `vendors/langgraph-harness/`.

## 2. Two-stack side-by-side map

| Axis | `@harness/` (`harness-repo-package-remediation/`) | **langgraph-harness** (`harness-repo-package-remediation/vendors/langgraph-harness/`) |
| --- | --- | --- |
| Role | Deterministic ingestion engine (CSV/XLSX → rows) | Config-driven LangChain/LangGraph flow platform |
| Layers / workspaces | `packages/*`: `@harness/core` (engine), `@harness/sdk` (facade), `@harness/cli` (`harness ingest`) | `sdk` (pipeline + 47 atoms), `backend` (Fastify API), `cli` (`langgraph-langchain-harness`), `frontend` (Vite console) |
| Module type | ESM (`"type": "module"`) | ESM (`"type": "module"`) |
| Node | `>=20` | `>=20.0.0` |
| Workspaces | npm workspaces, root globs `packages/*` | npm workspaces, root lists `sdk/backend/cli/frontend` |
| Runtime deps | `csv-parse` 7.0.1, `exceljs` 4.4.0 (core); `commander` 15.0.0 (cli) | `@langchain/core` 1.1.48, `@langchain/langgraph` 1.3.4, `yaml` 2.9.0, `zod` 3.25.76 (sdk); `fastify` 5.8.5 (backend); `vite` 8.0.16 (frontend, dev) |
| Dep policy | **Exact pins only** (README dependency policy) | **Exact pins only** (platform rule 8, frozen set) |
| Test model | mock-first `node --test`; `scripts/verify.mjs` (lint + offline test gate) | mock-first `node --test`; `npm run verify` = 91 tests + 9-example sweep + docs regen |
| Public API | `ingest(source, opts) → {rows, diagnostics, meta}` (`packages/sdk/src/ingest.mjs`) | `openFlow(flowPath, opts)` + `runFlow`/`resumeFlow` (`sdk/src/index.mjs`) |
| Overlap | **none** — disjoint dependency sets, so no version conflict | — |

Test counts for the vendored mirror (verified in place): sdk 57 · backend 13 · cli 10 · frontend 11
= **91**, all green offline; plus 9/9 example flows and deterministic docs regeneration.

## 3. Compatibility verdict

| Axis | Verdict | Evidence |
| --- | --- | --- |
| ESM | **PASS** | both `"type": "module"` |
| Node runtime | **PASS** | both require Node ≥ 20 |
| npm workspaces | **PASS** | both use npm workspaces |
| Exact pins | **PASS** | both mandate exact versions; dependency sets are **disjoint** → no overlapping-pin conflict |
| Mock-first `node:test` | **PASS** | both gate offline with `node --test`, no network / no key / no git |

**The one tension — two independent workspace roots.** harness's root `package.json` globs
`packages/*`; the vendored langgraph-harness sits at `harness-repo-package-remediation/vendors/langgraph-harness/` **outside** that glob and installs on
its own (`npm install` inside `vendors/langgraph-harness/`). This is **intended isolation**, not a defect: it
keeps langgraph-harness's frozen LangChain pins from mixing into harness's tree and keeps the subtree mirror
pristine. The integration package (`langgraph-harness-integration/`) is the bridge and depends on **both** roots
without merging them (see §6, resolution strategy).

## 4. Extension-seam inventory

Every seam is a real file in the vendored mirror.

| # | Seam | File(s) under `harness-repo-package-remediation/vendors/langgraph-harness/` | What it lets us do |
| --- | --- | --- | --- |
| S1 | **Custom-pattern (project atom)** | `configs/patterns/pop-queue.mjs`, `configs/patterns/summarize-section.mjs` | Drop a project-local atom file that the mapping loads by dynamic `import()` — proven by the built-in `commands.popQueue` / `skills.summarizeSection` customs |
| S2 | **Mapping-extends** | `configs/mapping.yaml` (`extends: default`) + `sdk/mapping.default.yaml` | Layer custom pattern names over the SDK's built-in mapping; later layers override by name |
| S3 | **LLM provider** | `sdk/src/llm/provider.mjs` (`createLlmProvider`, `ctx.llm.invoke`) | The single model seam: mock (default) / anthropic / openai. Every skill and `nodes.llm/agent` reaches models only here |
| S4 | **Loader / validate** | `sdk/src/loader/config-loader.mjs`, `sdk/src/loader/validate.mjs` | Parse + interpolate + normalize flow yaml; meta-schema + structural invariants with precise error paths |
| S5 | **Trust-boundary enforcement** | `sdk/src/mapping/mapping-loader.mjs` (`parseEntry`, `TrustBoundaryError`), `sdk/src/registry/registry.mjs` | `./`/`../` module specifiers must stay under the mapping dir; bare specifiers must start with `@internal/langgraph-langchain-harness-`; the registry is the ONLY `import()` site and verifies the atom contract |
| S6 | **Flow DSL** | `configs/flows/*.yaml` (e.g. `queue-worker.yaml`, `conditional-triage.yaml`) | `version/name/runtime/state/entry/nodes/edges` yaml; nodes `uses:` a pattern name + `with:` params; edges include `linear`, `switch`, `loop{max,on_max}`, `fanout` |

### The atom contract (S1) — captured, not invented

From a **custom** atom (`configs/patterns/pop-queue.mjs`) and a **built-in** atom
(`sdk/src/atoms/commands/fs-read.mjs`), verified by `sdk/src/registry/registry.mjs`:

- Each atom module exports **`meta`** and **exactly one factory function** (named by the mapping's
  `export:` field). `meta` shape:
  - `name` — the pattern name, e.g. `"commands.popQueue"`. **Must equal the mapping key** — the
    registry throws `RegistryError` if `meta.name !== name`.
  - `category` — the name prefix, e.g. `"commands"`. **Must equal the resolved category**.
  - `summary` — one-line description (powers `langgraph-langchain-harness patterns`, `/api/patterns`, docgen).
  - `params` — a mini-JSON-Schema (`type/required/properties`) the compiler validates each node's
    `with:` block against, with precise paths.
  - `returns` — `"node"` for node-producing atoms.
- The **factory** is `fn(params, ctx) → async (state) => delta`. It returns a **delta** (plain
  object of channel → value); it must only write channels the node declared in `writes:` (the
  `wrapNode` write filter in `sdk/src/compiler/wrap-node.mjs` silently drops undeclared channels,
  except the always-writable `error_logs` / `last_step`).
- **`ctx`** (built per node) exposes: `ctx.llm` (the S3 seam), `ctx.emit(type, payload)` (events),
  `ctx.registry` (resolve other atoms — how skills compose prompts), `ctx.node` (`{id, uses}`),
  `ctx.options` (`{baseDir, mock, dryRun, env, …}`), `ctx.flow`, `ctx.services`.
- Deterministic local I/O (e.g. `commands.fsRead`) runs for real even under mock; only
  network/git/subprocess and **model** calls are stubbed offline.

## 5. What `@harness/` contributes at each seam

| Seam | Harness contribution |
| --- | --- |
| S1 + S2 (custom pattern + mapping) | A **`commands.harnessIngest`** atom (`langgraph-harness-integration/configs/patterns/harness-ingest.mjs`) wrapping `@harness/sdk`'s `ingest()`, added with **one mapping line** in `langgraph-harness-integration/configs/mapping.yaml` (`extends: default`) |
| S6 (flow DSL) | An **`ingest → classify → report`** flow (`langgraph-harness-integration/configs/flows/harness-ingest-classify.yaml`) |
| S3 (LLM seam) | `skills.classify` (built-in) reasons over ingested rows via `ctx.llm` in **mock** mode — no keys, deterministic |
| Knowledge lane (optional, later) | Ingested rows could feed `knowledge.loadDocuments` → chunk → embed → retrieve for a RAG lane |

**Division of labor:** harness contributes **precision I/O** (format detection, header handling,
row normalization, diagnostics); langgraph-harness contributes **reasoning + topology** (the flow graph, the LLM
seam, the write filter, bounded loops, HITL). Neither reaches into the other's internals.

## 6. Recommended integration pattern

Author, under `harness-repo-package-remediation/vendors/langgraph-harness-integration/` (the sibling — never inside the mirror):

1. **`configs/patterns/harness-ingest.mjs`** — a `commands.harnessIngest` atom. `meta.name =
   "commands.harnessIngest"`, `meta.category = "commands"`, params `{path | path_from, format,
   limit, headers, into, diagnostics_into?}`. Factory imports `ingest` from `@harness/sdk` at module
   top (a Node ESM import, **not** a mapping specifier — the trust boundary only constrains the
   mapping's `module:` field) and returns `async (state) => ({ [into]: result.rows, … })`. Local
   file reads are deterministic, so the atom runs for real under mock — matching `commands.fsRead`.
2. **`configs/mapping.yaml`** — `version: 100`, `extends: default`, one `patterns:` line mapping
   `commands.harnessIngest → { module: "./patterns/harness-ingest.mjs", export: harnessIngest }`.
   The module is `./`-relative and lives under the mapping dir → passes the S5 trust boundary.
3. **`configs/flows/harness-ingest-classify.yaml`** — `commands.harnessIngest` (rows → `state.rows`)
   → `skills.classify` over a derived text (rows → `state.labels`) → `commands.renderReport` /
   `template.jsonReport` (→ `state.report`). `runtime.mock: ${MOCK:true}`, tight `reads:`/`writes:`,
   bounded edges.
4. **Resolution strategy for `@harness/sdk` inside langgraph-harness** (§3 tension): because langgraph-harness is a separate
   install root, `@harness/sdk` must be resolvable from the atom file. Preferred: declare
   `langgraph-harness-integration/` as its own tiny package that depends on `@harness/sdk` and on the vendored
   `@internal/langgraph-langchain-harness-sdk`, resolving `@harness/sdk` via an npm workspace link or a `node_modules` symlink into
   `harness-repo-package-remediation/packages/sdk`. The atom keeps `import { ingest } from "@harness/sdk"` — a clean bare
   specifier — while the mapping entry stays `./patterns/…` (so the trust boundary is satisfied).

## 7. Data-flow diagram

```
                                    ┌──────────────────── trust boundary (S5) ────────────────────┐
                                    │  mapping module: "./patterns/harness-ingest.mjs" (under dir) │
                                    └─────────────────────────────────────────────────────────────┘

 CSV / XLSX file
      │  (deterministic; runs for real even under mock)
      ▼
 @harness/sdk  ingest(source,opts)  ──▶  { rows, diagnostics, meta }
      │           (packages/sdk/src/ingest.mjs)
      ▼
 commands.harnessIngest  (langgraph-harness custom atom)  ──▶  state.rows   [ , state.ingest_diagnostics ]
      │   returns a delta; wrapNode write-filter enforces declared `writes:`
      ▼
 skills.classify  ─────────────────────────────▶  state.labels , state.verdict
      │        └───▶ ctx.llm.invoke({system,user,schema})   ◀── LLM seam (S3), mock mode (no key)
      ▼
 commands.renderReport / template.jsonReport ──▶  state.report   ──▶  END
```

- **Trust boundary (S5)** sits at the mapping entry: the atom file must live under the pack dir; the
  atom *imports* `@harness/sdk` internally (allowed).
- **LLM seam (S3)** sits at `skills.classify`'s single `ctx.llm.invoke` — mock by default, real only
  via `LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER` + a key, env-switched and exercised deliberately outside the gate.

## 8. Roadmap

| Phase | Work | Links |
| --- | --- | --- |
| **P1 — Vendor langgraph-harness** *(done)* | Squashed `git subtree add` into `harness-repo-package-remediation/vendors/langgraph-harness/`; verified 91 tests + 9 examples in place; vendors README + update rail | Epic 01 |
| **P2 — Analysis** *(done)* | This document: two-stack map, compatibility verdict, seam inventory, atom contract, recommended pattern | Epic 02 |
| **P3 — Reference atom + flow** | `commands.harnessIngest` atom + meta (Story 03/01/01); wire `@harness/sdk` as a resolvable dep (Story 03/01/02); config pack + `mapping.yaml extends default` (Story 03/02/01); `ingest→classify` flow (Story 03/02/02); mock-first atom + flow tests (Story 03/03/01); verify entrypoint + reference README (Story 03/03/02) | Epic 03 |
| **Later** | Additional source-type atoms (`commands.harnessIngestJson`, parquet); the RAG lane (`knowledge.loadDocuments` over ingested rows → chunk → embed → retrieve); real-provider env-switch (`LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) exercised deliberately **outside** the default gate | — |

## 9. Risk register

| Risk | Mitigation | Rule |
| --- | --- | --- |
| **Pin drift** — a range constraint sneaks into a manifest | Exact-pins-only; run the `enfore-actual-pinned-dep-versions` gate; disjoint dep sets mean no cross-stack conflict | platform rule 8; harness README dep policy |
| **Trust-boundary violation** — atom module escapes the pack dir or uses a foreign bare specifier | Keep the atom file under `langgraph-harness-integration/configs/patterns/`; the mapping entry stays `./…`; import `@harness/sdk` internally (resolved dep), never `../` | platform rule 6; langgraph-harness `mapping-loader.mjs` `TrustBoundaryError` |
| **Workspace-root confusion** — someone tries to fold langgraph-harness into `packages/*` | Vendored langgraph-harness installs independently as its own root; documented as intended isolation (§3) | platform rule 7; §3 |
| **Provider-SDK import in an atom** — bypassing the LLM seam | Atoms reach models only via `ctx.llm`; no provider SDK import anywhere in an atom | platform rule 2; security rule 5 |
| **Real-key leakage** — a credential lands in a fixture / flow yaml / commit | Credentials via env only; mock-first gate; no keys in fixtures/state/logs/commits | security rules 5, 6, 8 |
| **Unconfirmed outward writes** — the flow posts/publishes without consent | The reference flow writes only local files under a run dir; no PR/issue/publish; nothing outward without explicit confirmation | security rule 7 |
| **Unbounded iteration** — a per-row loop runs away | Per-row iteration uses `edges.loop {max, on_max}` or `edges.fanout`; every loop edge is bounded | platform rule 4 |
| **Subtree-pull conflicts** — edits inside the mirror fight upstream on refresh | Integration code lives only in the sibling `langgraph-harness-integration/`; `vendors/langgraph-harness/` stays a pristine mirror | Epic 01 vendors README |

---

*Generated for Epic 02 of the `vendor-v100-and-extend` plan. Mock-first, offline, no outward writes.*
