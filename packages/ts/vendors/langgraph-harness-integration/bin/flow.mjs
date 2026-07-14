#!/usr/bin/env node
/**
 * bin/flow.mjs — executable entry for the interactive `flow` wizard. Thin
 * shim: build the clack-backed prompter (real terminal UI via @clack/prompts +
 * chalk) and hand it to the orchestrator, then exit with the code it returns.
 * All logic lives in ../src/wizard.mjs; tests drive it with the scripted
 * prompter instead.
 *
 * One non-wizard sub-command (change record 0033/D0): `flow find-version
 * <verb> <package-manager> <package> [flags]` dispatches to the
 * version-discovery CLI instead of the wizard — see
 * ../src/version-discovery-cli.mjs for the surface.
 *
 * RENDER PATH FLAGS (see ../src/session-lib.mjs for the full seam). This pack is
 * vendored, but it is run from the project root above it — so where its `.harness`
 * tree materializes is a parameter, not a constant:
 *
 *   --harness-render-root <dir>      dir CONTAINING `.harness/`  ($HARNESS_RENDER_ROOT,
 *                                    default: the invocation cwd)
 *   --harness-render-package <name>  pack segment under the session dir
 *                                    ($HARNESS_RENDER_PACKAGE, default: this pack's
 *                                    directory name)
 *
 * Run from `harness-repo-package-remediation/`, the defaults render this pack's artifacts at
 * `harness-repo-package-remediation/.harness/<SESSION_ID>/langgraph-harness-integration/.harness/` rather
 * than inside `harness-repo-package-remediation/vendors/langgraph-harness-integration/`. ARG beats ENV.
 */
import { runWizard } from "../src/wizard.mjs";
import { clackPrompter } from "../src/ui/clack-prompter.mjs";
import { runFindVersionCli } from "../src/version-discovery-cli.mjs";
import { disableTracing } from "../src/tracing.mjs";

// 0052/D1: neutralize LangSmith tracing at the outermost entry, before anything
// touches the graph runtime. `run-flow.mjs` repeats this at the run seam (it is
// idempotent) so library/test callers that bypass this bin are covered too.
disableTracing();

const entry =
  process.argv[2] === "find-version"
    ? runFindVersionCli(process.argv.slice(3))
    : runWizard(process.argv, clackPrompter());

entry
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
