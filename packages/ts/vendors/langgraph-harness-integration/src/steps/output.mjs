/**
 * steps/output.mjs — choose where the JSON report artifact is written, and derive
 * every other artifact path from the run's SESSION ROOT.
 *
 * Paths are rooted at the invocation cwd (`ctx.cwd`), not the pack dir, so the
 * `.harness/` working directory lands next to wherever the user ran `flow` — the
 * natural project root — rather than buried inside this vendored pack.
 *
 * Change record `0024`/A1: `.harness/` is no longer the artifact root, it is the
 * CONTAINER OF SESSIONS. Everything this run writes hangs off
 * `.harness/<SESSION_ID>/` — the id step 1 (`steps/session.mjs`) established —
 * including the expensive-to-rebuild members (`repos/`, `.venv`). Scoping those
 * IS the resume mechanism: re-entering an existing session id finds its clones on
 * disk and the clone stage's `on_exist: skip` makes a resumed run cheap. Before
 * `0024` two consecutive `make start` runs overwrote each other in place.
 *
 * Change record `0053`/D1: a session written before `installs/` + `builds/` moved
 * under the pack render dir keeps them at its session root. They are INERT, not
 * stale inputs — stage state is not persisted across runs, so a resumed session
 * re-executes install/build and writes fresh logs to the pack-rooted path. No
 * migration reader is needed and none should be added.
 */
import { basename, relative, resolve } from "node:path";

import { packRenderDirIn, sessionDirFor } from "../session-lib.mjs";

const DEFAULT_FILENAME = "harness-ingest-classify.json";

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 */
export async function outputStep(ctx) {
  // Computed ONCE; every artifact path below is derived from it. `sessionDirFor`
  // re-runs the path-traversal guard, so a plan that reached here with an
  // unvalidated id throws rather than resolving outside `.harness/`.
  const sessionRoot = ctx.plan.sessionDir ?? sessionDirFor(ctx.renderRoot ?? ctx.cwd, ctx.plan.sessionId);
  // THE PACK'S OWN `.harness` TREE — `<session>/<package>/.harness` (render-path
  // seam; see src/session-lib.mjs). The three fields it roots below are the ones
  // this step used to leave unset, so `flow-plan.mjs`'s `../../.harness/<id>`
  // fallback answered instead — and since the materialized yaml lives in
  // `<pack>/.runs/wizard/`, that `../../` resolved to the VENDOR DIRECTORY. One
  // run then wrote two scattered `.harness/` trees: repos/snapshots/graphs under
  // the invocation cwd, but decision.jsonl/reports/tests inside the vendored pack.
  // Setting them here is what keeps a `make start` from `harness-repo-package-remediation/` whole.
  const packRoot = packRenderDirIn(sessionRoot, ctx.renderPackage ?? basename(ctx.pkgDir));
  // Offered relative (`.harness/<id>`) so the prompt's default stays readable.
  const defaultOutDir = relative(ctx.cwd, sessionRoot) || sessionRoot;

  const dirAnswer = await ctx.prompt.text({ message: "Output directory", defaultValue: defaultOutDir });
  const filename = await ctx.prompt.text({ message: "Report filename", defaultValue: DEFAULT_FILENAME });

  ctx.plan.outDir = resolve(ctx.cwd, dirAnswer);
  ctx.plan.filename = filename;
  ctx.plan.workspace = resolve(sessionRoot, "repos");
  // Fingerprint artifact (step 7): fingerprints.json under the session root,
  // sibling to repos/, so `make start` leaves clones and the fingerprint report side by side.
  ctx.plan.fingerprintsDir = sessionRoot;
  ctx.plan.fingerprintsFilename = "fingerprints.json";
  // Integrated manifest artifact (step 8): integrated.json under the same
  // session root, so clones, fingerprints, and manifests land side by side.
  ctx.plan.integratedDir = sessionRoot;
  ctx.plan.integratedFilename = "integrated.json";
  // Filesystem snapshot artifacts (step 9): one per-repo <reponame>.repo.json
  // under <session>/snapshots, a sibling of repos/ and the fingerprint/integrated
  // reports under the same session root.
  ctx.plan.snapshotsDir = resolve(sessionRoot, "snapshots");
  ctx.plan.snapshotsSuffix = "repo.json";
  // Dependency-graph stage (step 10, record 0017): the aggregate
  // dependency-graph.json lands under the same session root; the per-repo
  // sub-langgraph is the committed child flow inside this pack.
  ctx.plan.depgraphDir = sessionRoot;
  ctx.plan.depgraphFilename = "dependency-graph.json";
  // Run-wide error ledger (run-health-and-errors-log Epic 02):
  // <session>/errors.logs, sibling to repos/, fingerprints.json,
  // integrated.json. SESSION ROOT, NOT packRoot — deliberately: the 0053
  // ownership rule ("session root holds REPO facts; the pack render dir holds
  // pack-owned logs") makes errors.logs arguably a pack ledger, but it is a
  // RUN-WIDE fact — it answers "what happened to this run", belongs beside the
  // other run-wide artifacts a human already opens, and would be hidden two
  // directories down in a pack subdir. Do not "correct" this into packRoot.
  ctx.plan.errorsDir = sessionRoot;
  ctx.plan.errorsFilename = "errors.logs";
  // Final applied-changes export (step 18¾): <session>/final_applied_changes/,
  // a sibling of repos/ and the reports. SESSION ROOT, NOT packRoot — by the
  // 0053 ownership rule this is the clearest case there is: it holds facts
  // about the REPOS (their changed files), it is the artifact a human is most
  // likely to open or hand onward, and it must outlive the clone tree it was
  // lifted out of.
  ctx.plan.finalChangesDir = resolve(sessionRoot, "final_applied_changes");
  ctx.plan.depgraphConfig = resolve(ctx.pkgDir, "configs", "flows", "dependency-graph.yaml");
  // Ingest sub-langgraph (step 2, record 0021/A4+D1): the entry node is an
  // orchestrator over the committed child flow inside this pack. Rooted the same
  // way `depgraphConfig` is (0020/A1) — absolute here, pack-relative in the
  // FlowPlan fallback — so the loader's baseDir resolution finds it wherever the
  // materialized yaml lands. NOT session-scoped: it is committed source, not an
  // artifact this run writes.
  ctx.plan.ingestConfig = resolve(ctx.pkgDir, "configs", "flows", "ingest.yaml");
  // Declarative remediation policy (0019/D3) for the `remediate` node the
  // renderer emits — the committed policy inside this pack. Likewise not scoped.
  ctx.plan.policyPath = resolve(ctx.pkgDir, "configs", "policy", "remediation-policy.yaml");
  // Install stage (step 10, record 0026): the committed playbook tree inside
  // this pack (not session-scoped — committed source). The raw install logs are
  // pack-owned (0053/A1) — see the pack-rooted block below.
  ctx.plan.playbooksDir = resolve(ctx.pkgDir, "configs", "playbooks", "ecosystem-installation");
  // Build stage (step 13, record 0029/D1): the committed BUILD playbook tree
  // inside this pack (not session-scoped — committed source). The step-14
  // build_snapshot reuses `snapshotsDir` — snapshots are repo facts, not pack
  // logs, so they stay at the session root; the 0029/A1 phase namespace sub-dirs
  // (initial/, build/) disambiguate the two phases under the one snapshots root.
  ctx.plan.buildPlaybooksDir = resolve(ctx.pkgDir, "configs", "playbooks", "ecosystem-build");
  // The child flow parameterizes its raw-output dir via env
  // (${DEPGRAPH_SAVE_DIR:…}, default pack-relative). Root it under the SAME
  // session root as every other artifact, unless the caller already pinned it.
  // (The former $VENV_PATH seeding is gone — 0026/A4 superseded the run-global
  // tooling venv with the per-repo `<clone>/.venv-deptry`.)
  process.env.DEPGRAPH_SAVE_DIR ??= resolve(sessionRoot, "dependency-graphs");

  // ── The pack-owned artifacts, rendered under `<session>/<package>/.harness` ──
  // Decision log (0032/D1): the run's JSONL audit trail.
  ctx.plan.decisionLogPath = resolve(packRoot, "decision.jsonl");
  // Remediation reports (capability 7): the atom writes `reports/` + the
  // aggregate `remediation-report.json` beneath this base.
  ctx.plan.reportsBaseDir = packRoot;
  // The three raw-log roots of the playbook-driven stages (install / build /
  // test) — one artifact class, one root (0053/A1+A2). Their shape is defined by
  // this pack's `configs/playbooks/` tree and they are only ever read back by
  // this pack's diagnose-lib and report renderers, so they are pack-owned; the
  // session root is for artifacts a run produces about the REPOS (clones,
  // snapshots, fingerprints, dependency graphs, the JSON/HTML reports).
  // `installsDir` feeds both `install` and `install_verify` (render-flow.mjs), so
  // the verify stage keeps reading exactly the logs the install stage wrote.
  ctx.plan.installsDir = resolve(packRoot, "installs");
  ctx.plan.buildsDir = resolve(packRoot, "builds");
  ctx.plan.testsDir = resolve(packRoot, "tests");
  ctx.plan.packRenderDir = packRoot;

  ctx.prompt.success(`Output: ${resolve(ctx.plan.outDir, filename)}`);
  ctx.prompt.success(`Pack artifacts: ${packRoot}`);
}
