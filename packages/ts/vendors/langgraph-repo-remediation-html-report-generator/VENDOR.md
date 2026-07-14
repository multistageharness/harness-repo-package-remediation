# Vendor provenance — `@harness/langgraph-repo-remediation-html-report-generator`

This directory is **harness-OWNED source**, not a mirror. Unlike the pristine
`git subtree` mirrors (`langgraph-harness/`, `repository-fingerprint/`) and the
tarball-digest-pinned `tools-cli-progress-bar/`, there is no upstream to refresh from:
the code originated in this repo and is maintained here.

| Field | Value |
| :--- | :--- |
| Kind | harness-owned source (**not** a vendored mirror) |
| Origin | extracted from `vendors/langgraph-harness-integration/src/html-report-lib.mjs` (1139 lines) |
| Extracted by | change record `0055` — *Extract the HTML report renderer into its own vendor package* |
| Package name | `@harness/langgraph-repo-remediation-html-report-generator` (the `@harness/*` family, like the pack and `@harness/sdk` — **not** the `@internal/*` subtree-mirror convention) |
| Runtime dependencies | **none** — and by design (record 0055/D1) |
| Consumed by | `vendors/langgraph-harness-integration/configs/patterns/render-html-report.mjs`, via the bare specifier |

## It is linted and gated

Because it is harness-owned, it is **in scope** for the repo's gates — the opposite of
the pristine mirrors, which are excluded from `eslint.config.mjs` / `biome.json` because
they pass *upstream's* ruleset, not this repo's:

- **Lint** — ESLint + Biome cover it by default (it is not in either ignore list). The one
  exception is `test/fixtures/golden-report.html`, which `biome.json` excludes: Biome lints
  HTML including its inline `<style>` and `<script>`, and that file is **rendered output**,
  not authored source — the same class as the already-excluded `.harness/**` artifacts.
  Linting a snapshot of generated output is meaningless, and auto-fixing it would corrupt the
  golden. (It produced 64 findings before the exclusion; every authored file here is clean.)
- **Tests** — its own gate (`npm --prefix vendors/langgraph-repo-remediation-html-report-generator run verify`),
  and the root gate (`npm run verify`) collects it too: `scripts/verify.mjs` walks the
  harness-owned `vendors/*` workspaces, not just `packages/*` (record 0055/A6).

## ~~Do not give it a local formatter config~~ — RETIRED by record 0057

This section used to warn that `src/client.mjs` and `src/style.mjs` were emitted into the
report as their **own source text** (`clientMain.toString()`), so a formatter reflowing them
rewrote the HTML bytes and failed the golden gate for a purely cosmetic reason.

**All three files are gone** (record 0057/A3). React is now the single source of truth for
markup, CSS, and interactivity; the UI arrives as a compiled Vite bundle, so no source text
is smuggled into the output any more. The byte-fidelity rule died with the mechanism that
required it, and `src/report/report.css` in the React package can be formatted freely.

## The committed bundle is generated output

`vendor/report-ssr.mjs`, `vendor/report-client.js`, and `vendor/report.css` are built from
`../langgraph-repo-remediation-html-report-reactjs/src/report/` and checked in (record
0057/D1). They are excluded from ESLint and Biome for the same reason `golden-report.html`
is: linting generated output — here, a bundle with React compiled into it — is meaningless.

Their freshness is gated instead, which is stronger than a linter: `scripts/verify.mjs` runs
`build:bundle -- --check`, which rebuilds, compares, writes nothing, and **fails** when the
committed bundle no longer matches the React source. Without that gate, editing a component
and forgetting to rebuild would ship a report that does not reflect its own source, with
every test still green.
