/**
 * src/progress-lib.mjs — the single site that reaches into the vendored
 * CLI progress-bar library (`@internal/tools-cli-progress-bar`).
 *
 * The progress-rendering logic is OWNED by the tools-cli-progress-bar tool
 * (harness-repo-package-remediation/vendors/tools-cli-progress-bar/main.mjs) — a dependency-free, no-build
 * ESM module. It is imported by RELATIVE path into that pristine mirror, NOT as a
 * declared dependency, mirroring how src/fingerprint-lib.mjs bridges the
 * repository-fingerprint report library and src/snapshot-lib.mjs bridges the
 * filesystem-snapshot tool. The clack prompter binding
 * (`src/ui/clack-prompter.mjs`) constructs the real bar through HERE, staying
 * inside the pack's trust boundary — it never reaches across the vendor boundary
 * directly. The scripted binding never touches this module (it no-ops the
 * progress seam to a transcript line), so the whole wizard stays TTY-free and
 * offline in tests.
 */
export {
  // ProgressBar(total, description, renderer?): .start() / .update(inc) / .complete() / .stop()
  ProgressBar,
  // CLIProgressHelper.withProgress(total, description, async (update) => …)
  CLIProgressHelper,
  // indeterminate spinner
  Spinner,
} from "../../tools-cli-progress-bar/main.mjs";
