# tools-cli-progress-bar (`@internal/tools-cli-progress-bar`)

A vendored, dependency-free ESM **CLI progress-bar** library. It renders a
terminal progress bar (`[████……] 60% (3/5)`-style) plus a spinner, using only
Node built-ins — zero runtime dependencies, no build step. The integration pack
imports it **in-process by relative path** to drive the `flow` wizard's
stage-progress indicator ("stage X of N").

## Why it is vendored (not a declared dependency)

Same discipline as the sibling vendored tools
[`repository-fingerprint/`](../repository-fingerprint/) and
[`tools-repo-filesystem-snapshots/`](../tools-repo-filesystem-snapshots/): the
source is mirrored here and imported by **relative path**, never added to any
`dependencies`/`devDependencies` block and never resolved from a registry. This
keeps installs deterministic and offline (no npm round-trip, no
Verdaccio/registry-availability risk) and de-couples the repo from the upstream
publisher's namespace by renaming the vendored copy to the neutral `@internal/`
scope. The integration pack reaches this tool through a single bridge module
(`langgraph-harness-integration/src/progress-lib.mjs`), mirroring
`src/fingerprint-lib.mjs` and `src/snapshot-lib.mjs`.

## Provenance

- **Upstream repo:** `carlosmarte/npm-cli-progressor`
- **Upstream npm package:** `@thinkeloquent/cli-progressor@1.0.2` (ESM,
  `type: module`, zero runtime deps, `engines.node >= 16`)
- **Vendored via:** `npm pack @thinkeloquent/cli-progressor@1.0.2` — pristine
  source copy (registry tarball, not `git subtree`, since the upstream Git SHA
  is not published to npm). See [`VENDOR.md`](VENDOR.md) for the exact tarball
  pin (shasum / integrity) so a refresh is reproducible.
- **Only edit:** `package.json` `name` changed
  `@thinkeloquent/cli-progressor` → `@internal/tools-cli-progress-bar`. Every
  other file (`main.mjs`, the upstream tests) is copied **verbatim** — do not
  hand-edit the vendored source beyond the rename.

## Public API (from `main.mjs`)

- `ProgressBar(total, description, renderer?)` — `.start()`, `.update(inc = 1)`,
  `.complete()` (renders the final bar), `.stop()`, `.getProgress()`,
  `.isCompleted()`, plus factory helpers `ProgressBar.createConsole/createSilent/createSpinner`.
  The default renderer auto-selects `SilentProgressRenderer` when the terminal is
  non-interactive, so the bar is inert off a TTY.
- `CLIProgressHelper.withProgress(total, description, async (update) => …)` —
  wraps an async task, auto-`start()`/`complete()`.
- `Spinner`, `Colors`, `TerminalUtils`, `ProgressTracker`, the renderer classes,
  `ProgressBarBuilder`, `MultiProgressManager`, `ProcessManager`,
  `StandardProgressCalculator` — the full upstream surface is re-exported.

## Pristine-mirror rule

Treat this directory as read-only upstream. Do **not** add integration code here
— that lives in the sibling `langgraph-harness-integration/` pack (behind
`src/progress-lib.mjs`). Keeping the mirror pristine lets a future refresh stay a
clean re-vendor.
