/**
 * src/wizard.mjs — the `flow` wizard orchestrator.
 *
 * Runs an ordered list of guided steps over a shared context and an injected
 * `Prompter`, then materializes → validates → runs the walked flow config
 * through the vendored @internal/langgraph-langchain-harness-sdk, and presents the report. Returns a process
 * exit code. The interactive CLI runs the flow FOR REAL (native `git clone`) —
 * mock mode is a test-only construct, injected at the SDK seam via the `mock`
 * option (see `runWizard`), never offered as an interactive prompt.
 *
 * Everything is pure w.r.t. the injected `prompt` (it never reads
 * `process.stdin` directly): `bin/flow.mjs` passes the clack prompter for a
 * real terminal (and no `mock` option → real run), while tests pass the
 * scripted prompter plus `{ mock: true }` — so the whole wizard is driveable
 * with no TTY, no network, no key, no git.
 *
 * Control flow beyond a linear list:
 *   - a step may raise `StepRetry(target)` to jump back to an earlier step
 *     (preview → input-file on a bad file);
 *   - a step may raise `WizardDone(code)` to end cleanly (declined confirm → 0);
 *   - a failed config-validation re-routes the user to the owning step, then
 *     re-materializes and re-validates, bounded to a few attempts.
 *
 * @typedef {Object} WizardCtx
 * @property {import("./ui/prompter.mjs").Prompter} prompt  the interaction seam
 * @property {Record<string, any>} plan   the FlowPlan under construction
 * @property {string} cwd                 invocation cwd (for relative input paths)
 * @property {string} pkgDir              this pack's root (for config/scratch paths)
 * @property {string[]} argv              raw process argv (render-path flags, below)
 * @property {string} renderRoot          dir CONTAINING `.harness/` (ARG/ENV/cwd)
 * @property {string} renderPackage       pack segment under the session dir (ARG/ENV/basename)
 * @property {string|null} pinnedSessionId  non-interactive session seam (0024/D2)
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StepRetry, WizardDone } from "./step-control.mjs";
import { sessionStep } from "./steps/session.mjs";
import { ingestSourceStep } from "./steps/ingest-source.mjs";
import { inputFileStep } from "./steps/input-file.mjs";
import { previewStep } from "./steps/preview.mjs";
import { headerSelectStep } from "./steps/header-select.mjs";
import { repoColumnStep } from "./steps/repo-column.mjs";
import { mappingStep } from "./steps/mapping.mjs";
import { outputStep } from "./steps/output.mjs";
import { confirmStep } from "./steps/confirm.mjs";
import { failedClones, presentReport } from "./steps/report.mjs";
import { buildFlowPlan } from "./flow-plan.mjs";
import { writeFlow } from "./materialize.mjs";
import { validateMaterialized, runMaterialized, mapIssueToStep, renderExitVerdict, verdictExitCode } from "./run-flow.mjs";
import { resolveRenderPackage, resolveRenderRoot } from "./session-lib.mjs";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_VALIDATE_ATTEMPTS = 3;

/**
 * Ordered collection steps, keyed by id so re-routes can target one.
 *
 * A third element is an optional `when(ctx)` guard (change record 0021/A3).
 *
 * `session` runs FIRST (change record 0024/A2) — every run mints or resumes the
 * UUID that roots `.harness/<SESSION_ID>/`. It is never lane-gated: the id must
 * exist before `output` can compute any artifact path and before the confirm gate
 * can name where the run will write, and no lane is known yet.
 *
 * `ingest-source` follows — "first ask the user what they are ingesting" — and
 * the three SPREADSHEET steps that follow `input-file` only apply to the
 * `local_csv` lane: `preview`, `header-select`, and `repo-column` all re-parse
 * `ctx.plan.inputPath` with `@harness/sdk`'s `ingest()`, which a URL, a repo
 * directory, or a placeholder lane has nothing to give them. `ingest-source`
 * seeds the two fields they would have set (`repoColumn`, `selectedHeaders`).
 *
 * Skipped steps still occupy a slot in the progress total, so the denominator
 * the user sees stays deterministic and doesn't depend on their selection.
 */
const isLocalCsv = (ctx) => (ctx.plan.ingestSource ?? "local_csv") === "local_csv";

const STEPS = [
  ["session", sessionStep],
  ["ingest-source", ingestSourceStep],
  ["input-file", inputFileStep],
  ["preview", previewStep, isLocalCsv],
  ["header-select", headerSelectStep, isLocalCsv],
  ["repo-column", repoColumnStep, isLocalCsv],
  ["mapping", mappingStep],
  ["output", outputStep],
];

/**
 * The fixed post-collection tail the orchestrator always runs, one progress
 * stage each: materialize+confirm, validate, run, present-report. Added to
 * `STEPS.length` for the deterministic total the progress overlay reports.
 */
const TAIL_STAGES = 4;

/**
 * @param {string[]} [argv]
 * @param {import("./ui/prompter.mjs").Prompter} prompt  interaction seam (clack or scripted)
 * @param {{mock?: boolean, sessionId?: string}} [options]
 *   `mock` — test-only SDK seam. Omitted by the real CLI (`bin/flow.mjs`) → the
 *   flow runs FOR REAL (native `git clone`). Tests pass `{ mock: true }` to keep
 *   the offline acceptance contract (no network, no git). There is no interactive
 *   mock/real prompt.
 *   `sessionId` — non-interactive session seam (change record 0024/D2). When
 *   present (or when `$HARNESS_SESSION_ID` is set) the `session` step skips both
 *   prompts and pins the run's artifact root to `.harness/<sessionId>/`, so a
 *   scripted run is deterministic and leaves no orphan session dir. Precedence:
 *   explicit option > env > interactive prompt.
 * @returns {Promise<number>} process exit code
 */
export async function runWizard(argv = process.argv, prompt, { mock = false, sessionId } = {}) {
  const cwd = process.cwd();
  const ctx = {
    prompt,
    plan: { mock: mock === true },
    cwd,
    pkgDir: PKG_DIR,
    argv,
    // RENDER PATH SEAM (see src/session-lib.mjs). Resolved ONCE, here, so every
    // step downstream reads one already-decided answer rather than each re-reading
    // argv/env and risking a different one. `renderRoot` is the directory that
    // CONTAINS `.harness/` (default: the invocation cwd — `harness-repo-package-remediation/` when the user
    // runs `make start`); `renderPackage` names this vendored pack, so its own
    // artifacts render at `<renderRoot>/.harness/<id>/<renderPackage>/.harness/`
    // instead of scattering into the vendor directory.
    renderRoot: resolveRenderRoot({ cwd, argv }),
    renderPackage: resolveRenderPackage({ pkgDir: PKG_DIR, argv }),
    pinnedSessionId: sessionId ?? process.env.HARNESS_SESSION_ID ?? null,
  };
  const byId = new Map(STEPS);

  // Stage-progress overlay over the known total: the ordered collection steps
  // plus the fixed post-collection tail. Optional seam (`?.`) so a binding
  // without `progress` still runs; the scripted binding no-ops it to the
  // transcript. Declared here so the catch/finally can close it; opened right
  // after the intro banner below.
  let stages;

  try {
    prompt.intro("langgraph-harness flow wizard");
    stages = prompt.progress?.({ total: STEPS.length + TAIL_STAGES, label: "flow stages" });
    await runCollection(ctx, stages);

    // Assemble → materialize → confirm (one stage). Announce BEFORE prompting so
    // the stage line sits above the confirm gate.
    let flowPlan = buildFlowPlan(ctx.plan);
    let yamlPath = await writeFlow(flowPlan, ctx.pkgDir);
    stages?.advance(1, "materialize");
    const proceed = await confirmStep(ctx, flowPlan, yamlPath);
    if (!proceed) {
      stages?.done();
      prompt.outro("Aborted before validate/run — no flow was executed.");
      return 0;
    }

    // Validate, re-routing to the owning step on failure (bounded). Announced
    // once, before the work; a re-route re-runs a stage within the same validate
    // budget rather than adding to the total.
    stages?.advance(1, "validate");
    let validation = await validateMaterialized(ctx, yamlPath);
    for (let attempt = 1; !validation.ok; attempt++) {
      if (attempt > MAX_VALIDATE_ATTEMPTS) {
        stages?.done();
        prompt.error(`Validation still failing after ${MAX_VALIDATE_ATTEMPTS} attempts — aborting.`);
        return 1;
      }
      const target = mapIssueToStep(validation.issues[0]?.path, validation.config);
      prompt.warn(`Re-routing to the '${target}' step to correct the configuration…`);
      const step = byId.get(target) ?? inputFileStep;
      await step(ctx);
      flowPlan = buildFlowPlan(ctx.plan);
      yamlPath = await writeFlow(flowPlan, ctx.pkgDir);
      validation = await validateMaterialized(ctx, yamlPath);
    }

    // Compile + run (real for the interactive CLI; mock only via the test seam),
    // then present the report — each announced before its work.
    stages?.advance(1, "run");
    const result = await runMaterialized(ctx, validation);
    stages?.advance(1, "report");
    presentReport(ctx, result, flowPlan);
    stages?.done();
    // The CLI exit verdict (run-health-and-errors-log Epic 03): the
    // consolidated cause + the absolute errors.logs path, in the terminal the
    // user is already looking at — remedy, not symptom.
    const summary = renderExitVerdict(ctx, result.state ?? {});
    // Exit-code contract (see verdictExitCode + harness-repo-package-remediation/docs/env.md): 0 for a
    // clean run OR an honestly-reported environmental block; 1 for
    // code-attributable failures or a flow that did not complete. Clone
    // failures land as data (0019/A1), so the legacy fallback below still
    // covers a run whose errors stage never produced a verdict.
    const failures = failedClones(result.state ?? {});
    const verdictCode = result.status === "completed" ? verdictExitCode(summary) : 1;
    const ok = verdictCode !== null ? verdictCode === 0 : result.status === "completed" && failures.length === 0;
    prompt.outro(ok ? "Done." : failures.length > 0 ? `Finished with ${failures.length} clone failure(s).` : "Finished with errors.");
    return ok ? 0 : 1;
  } catch (err) {
    stages?.done();
    if (err instanceof WizardDone) return err.code;
    prompt.error(`Error: ${err.message}`);
    return 1;
  }
}

/**
 * Run the ordered collection steps, honoring StepRetry jumps. Announces the
 * progress overlay as a LEADING indicator — the stage line for a step is printed
 * *before* that step runs, so it sits directly above that step's prompt (naming
 * the step the user is being asked about, not the one that just finished). The
 * count still only advances across a new high-water mark; a StepRetry back-jump
 * re-runs a step and re-announces at the current mark (advance 0) rather than
 * double-counting or regressing the monotonic total.
 */
async function runCollection(ctx, stages) {
  let i = 0;
  let reached = 0; // high-water mark of distinct steps entered (1-based)
  while (i < STEPS.length) {
    const [id, fn, when] = STEPS[i];
    // A lane-gated step (0021/A3) still consumes its progress slot so the
    // denominator is selection-independent; it is announced as skipped.
    const active = typeof when !== "function" || when(ctx) === true;
    const label = active ? id : `${id} (n/a for the '${ctx.plan.ingestSource}' lane)`;
    // Announce BEFORE running: name the step we're about to prompt for.
    if (i + 1 > reached) {
      reached = i + 1;
      stages?.advance(1, label);
    } else {
      stages?.advance(0, label);
    }
    if (!active) {
      i++;
      continue;
    }
    try {
      await fn(ctx);
      i++;
    } catch (err) {
      if (err instanceof StepRetry) {
        const idx = STEPS.findIndex(([sid]) => sid === err.target);
        if (idx === -1) throw err;
        i = idx;
        continue;
      }
      throw err;
    }
  }
}
