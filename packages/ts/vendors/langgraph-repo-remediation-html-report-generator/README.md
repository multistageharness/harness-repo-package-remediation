# `@harness/langgraph-repo-remediation-html-report-generator`

The single-page HTML report for the repo-remediation pipeline. Give it the run's output
channels, get back one self-contained HTML document that explains the whole run.

Deterministic and dependency-free: no clock, no `Math.random()`, no network, no external
assets. The same channels always render the same bytes.

## This package is the DATA layer. React is the UI. (record 0057)

The report is built by two packages with one job each:

| | package | owns |
| :-- | :--- | :--- |
| **data** | this one | `buildReportData(channels, {keyOf}) → ReportData` — joins the 13 channels into one serializable value |
| **UI** | `../langgraph-repo-remediation-html-report-reactjs` | all markup, CSS, and interactivity |

They are unified through a **build artifact**, not a runtime dependency. Vite compiles the
React tree — with React itself compiled *in* — into three self-contained files that are
**committed** under `vendor/` and imported here by a relative path:

```
vendor/report-ssr.mjs      renderReport(data) → string   (the prerender)
vendor/report-client.js    the hydration IIFE            (inlined in <script>)
vendor/report.css          the stylesheet                (inlined in <style>)
```

**This is why the zero-dependency invariant survives.** React's ~325 dependencies are needed
at BUILD time, never at RUNTIME. This package still declares zero dependencies, still has no
bare import anywhere in `src/`, still tests offline with no `node_modules`, and still renders
without touching a registry — which matters concretely when the local registries are down.

> **Superseded.** This file used to say the two packages *"deliberately share no code"* and
> that a React toolchain was *"incompatible with this one's invariants"*. That was true of the
> old design and is now false. The duplication it warned about had already happened: the two
> UIs drifted until they had **disjoint `data-testid` vocabularies**, and two of the three
> defects fixed in record 0056 were structurally *inexpressible* in the React tree's contract.
> React is now the single source of truth for the UI, and nothing is rendered twice.

**Editing the UI?** Change `reactjs/src/report/`, then run `npm run build:bundle` in that
package to rebuild and republish `vendor/`. The `verify` gate runs `build:bundle -- --check`
and fails if you forget — a committed artifact that can go stale needs a gate that says so.

## Usage

```js
import { renderDocument, REPORT_CHANNELS } from "@harness/langgraph-repo-remediation-html-report-generator";
import { writeFile } from "node:fs/promises";

const html = renderDocument(channels);              // standalone <!doctype html> page
await writeFile("repo-remediation.html", html);
```

In the harness, the pack's `commands.renderHtmlReport` atom is a thin adapter over
exactly this call — it picks the channels off the graph state, injects the pipeline's own
repo-key normalizer, and writes the result atomically.

## Public API

| Export | Signature | Purpose |
| :-- | :-- | :-- |
| `renderDocument` | `(channels, opts?) => string` | the full standalone page |
| `renderHtml` | `(channels, opts?) => string` | the body only, for embedding |
| `REPORT_CHANNELS` | `string[]` | the input contract (below) |
| `esc` | `(value) => string` | the HTML escaper, for callers composing fragments |
| `defaultKeyOf` | `(url) => string \| null` | the standalone repo-key fallback |

`opts` is `{ keyOf }` — nothing else.

## The channel contract

`REPORT_CHANNELS` names the thirteen channels the renderer reads. Anything else on the
object is ignored:

`dataset` · `clone_results` · `plans` · `optimized_prompts` · `remediations` ·
`validations` · `installs` · `install_verifications` · `builds` · `tests` ·
`dependency_graphs` · `snapshots` · `build_snapshots`

It is exported so a caller can derive its own schema from it rather than hand-copying the
list — which is exactly what the pack's atom does for its `<channel>_from` params.

## `keyOf` — the one seam that matters

The renderer joins its channels into per-repo rows by normalizing each row's repo URL. **That
key must be the same function the pipeline built the channels with**, or repos silently fail
to join and the detail panels render empty. So the key is injected:

```js
renderDocument(channels, { keyOf: normalizeRepoUrl });   // the pipeline's own normalizer
```

`defaultKeyOf` ships only so the package works standalone. It is not the harness's source of
truth — `langgraph-harness-integration/src/repo-url.mjs` is, and a parity test in the pack
asserts the two agree, so the fallback cannot quietly diverge (record `0055`/A3).

## What it renders

Two views. **Overview**: stat tiles (repos, vulnerabilities, plan actions, pass rate, and the
five outcome counts), a pass-rate note, a sortable run-results table, the pipeline stage list,
and severity bars. **Repositories**: a searchable, ecosystem-filterable sidebar; a per-repo
detail panel with a stage snapshot rail + manifest diff, advisories, the optimized SDK prompt,
an applied-changes table, a resolved-dependency SVG graph (with a *show remediated versions*
toggle), a stage-log viewer, and repo/build metadata; plus a per-repo pass-rate donut, outcome
ledger, and CVE references.

Navigation is **pure CSS** (hidden radios + `:checked ~` selectors), so the report works with
JavaScript blocked, under any CSP, and inside sandboxed preview panes. The inline script only
enhances (search, filters, snapshot picker, graph toggle, log filtering).

Pass rate is `fixed ÷ (fixed + broken + bug)` — decided outcomes only. **Blocked** (environment
or pre-existing) and **skipped** (benign no-op) are excluded, so a down registry never depresses
the remediation score.

## Invariants (do not break these)

- **Zero runtime dependencies** — the React bundle is a committed build artifact, imported by a
  relative path. `package.json` declares no dependencies and `src/` contains no bare import;
  `test/fixtures.test.mjs` asserts both. This is what lets the report render offline.
- **Deterministic** — no clock, no random. Cosmetic-only fields the run does not record are derived
  by FNV-1a over stable identifiers (`src/derive.mjs`). This is what makes the golden replay
  possible. (The only I/O is reading this package's own committed bundle, once, at module load.)
- **Escape everything** — external text is DATA, never markup. Two DIFFERENT escapers, and using the
  wrong one is a real bug: `esc()` for markup, `serializeIsland()` for the JSON island. A browser
  does not decode HTML entities inside a `<script>`, so `esc()` there would corrupt the JSON *and*
  fail to stop a `</script>` breakout. See `src/document.mjs` and `test/island.test.mjs`.
- **Offline** — inline CSS + inline JS only; no external asset ever. Asserted by `render.test.mjs`.
- **Content-complete without JS** — every view, every repo detail, and every tab panel is in the
  prerendered markup; navigation is CSS `:checked` radios, and the client bundle only *enhances*.
  The report is fully readable and navigable with JavaScript disabled. This is not a nicety: the
  generator's `behavior.test.mjs` slices five different repo cards out of the emitted HTML, so a
  React tree that mounted one view at a time would fail it. See `reactjs/src/report/navCss.ts`.
- **The `data-testid` vocabulary is a contract** — `repo-card`, `stat-<id>` (all nine),
  `passrate-note`. The pack's matrix tests and the flow test regex them out of the emitted HTML.

## Tests

```
npm --prefix vendors/langgraph-repo-remediation-html-report-generator run verify
```

- `render.test.mjs` — escaping, structure, pass-rate math, the token tables.
- `keyof.test.mjs` — the injection seam.
- `client.test.mjs` — pins `clientMain`'s source text so a formatter run fails loudly.
- `behavior.test.mjs` — the **adversarial** fixture: a repo with a skipped remediation, a `broken`
  repo, a plan action with no matching vulnerability, a blocked repo, an `n/a` build. Every prior
  fixture in this codebase was uniformly green, which is precisely why three renderer defects
  survived a fully-tested renderer (record `0056`). This is where correctness is pinned.
- `golden.test.mjs` — a byte-identical replay of a real recorded run. A behavioral change here is
  a 253 KB diff, on purpose: it is a checkpoint, not a monument. When a fix intentionally changes
  the output, regenerate it (`node test/fixtures/regenerate.mjs`) and say so in the change record.
