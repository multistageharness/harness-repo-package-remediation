/**
 * src/flow-plan.mjs — consolidate the walked answers into one validated
 * FlowPlan the materializer/renderer consume. Pure (no I/O) so it unit-tests
 * directly and re-runs cheaply inside the validation correction loop.
 *
 * Change record 0021 (A2/A3): `ingestPattern` is GONE. With the ingest entry
 * node now an orchestrator (`nodes.subgraph` over `configs/flows/ingest.yaml`),
 * "which atom is the entry node" is no longer a meaningful question — it is
 * always `nodes.subgraph`. The meaningful question is "which LANE", so
 * `ingestSource` (a closed enum, see `src/ingest-lanes.mjs`) replaces it.
 * `inputPath` likewise stops being unconditionally required: only the
 * `local_csv` lane has one. What every lane needs is `ingestRef` — and even that
 * is optional for the two placeholder lanes, which take no reference at all.
 *
 * Change record 0024 (A1/D1): `sessionId` is a REQUIRED field — a session-less
 * FlowPlan is a bug, not a default — and every artifact-path fallback carries the
 * `<sessionId>` segment, so a plan built without a wizard walk is still rooted at
 * `.harness/<SESSION_ID>/` rather than at the shared `.harness/`.
 */

import { INGEST_SOURCES, laneNeedsRef } from "./ingest-lanes.mjs";
import { isValidSessionId } from "./session-lib.mjs";

/**
 * Fields no lane can do without. `ingestRef` is required conditionally, below.
 * `sessionId` trails the others so a plan missing several fields still names the
 * one a wizard walk would have filled first (the `repoColumn` diagnostic).
 */
const REQUIRED = ["mappingPath", "ingestSource", "repoColumn", "outDir", "filename", "sessionId"];

/**
 * @param {Record<string, any>} plan the accumulating `ctx.plan`
 * @returns {{sessionId: string, sessionDir: string, mappingPath: string,
 *   ingestSource: string, ingestRef: string, inputPath: string|null,
 *   repoColumn: string, selectedHeaders: string[], mock: boolean, outDir: string,
 *   filename: string, name: string}}
 * @throws {Error} on any missing required field, an ingest source outside the
 *   enum, or a `sessionId` that is not a canonical UUID
 */
export function buildFlowPlan(plan) {
  for (const field of REQUIRED) {
    const value = plan?.[field];
    if (value === undefined || value === null || value === "") {
      throw new Error(`FlowPlan is missing required field '${field}' — complete the wizard steps first`);
    }
  }
  // The enum is the guardrail 0001/A1 asked for, retained as an acceptance
  // criterion: a token outside it would route to the child flow's loud-failure
  // lane, so reject it HERE — before materializing — with the legal set named.
  if (!INGEST_SOURCES.includes(plan.ingestSource)) {
    throw new Error(`FlowPlan field 'ingestSource' must be one of ${INGEST_SOURCES.join(" | ")} (got '${plan.ingestSource}')`);
  }
  // The four non-placeholder lanes each consume a path / URL / directory.
  if (laneNeedsRef(plan.ingestSource) && !plan.ingestRef) {
    throw new Error(`FlowPlan is missing required field 'ingestRef' — the '${plan.ingestSource}' lane needs a reference to ingest`);
  }
  // 0024/D1: the id is concatenated into every artifact path below. Re-run the
  // path-traversal guard HERE — `buildFlowPlan` is reachable without a wizard
  // walk (tests, the validation correction loop), so `steps/session.mjs`'s check
  // is not the only gate.
  if (!isValidSessionId(plan.sessionId)) {
    throw new Error(`FlowPlan field 'sessionId' must be a canonical UUID (got '${plan.sessionId}')`);
  }

  const sessionRel = `../../.harness/${plan.sessionId}`;

  return {
    // step 1 (0024/D1): the run-scoped artifact root every path below hangs off.
    sessionId: plan.sessionId,
    sessionDir: plan.sessionDir ?? sessionRel,
    // step 2 (0021/A1–A4): the ingest orchestrator's two channel seeds.
    ingestSource: plan.ingestSource,
    ingestRef: plan.ingestRef ?? "",
    // The local CSV/XLSX path, when the lane has one — the spreadsheet wizard
    // steps and the confirm summary read it. `null` for every other lane.
    inputPath: plan.inputPath ?? null,
    mappingPath: plan.mappingPath,
    repoColumn: plan.repoColumn,
    selectedHeaders: Array.isArray(plan.selectedHeaders) ? plan.selectedHeaders.slice() : [],
    mock: plan.mock === true, // real by default; mock only via the test seam
    outDir: plan.outDir,
    filename: plan.filename,
    // Ingest sub-langgraph (step 2, record 0021/D1). Same rooting discipline as
    // `depgraphConfig` (0020/A1): the fallback resolves from the .runs/wizard
    // scratch dir back to the committed child flow; the wizard overrides absolute.
    // NOT session-scoped — committed source, not an artifact this run writes.
    ingestConfig: plan.ingestConfig ?? "../../configs/flows/ingest.yaml",
    // Clone workspace: absolute (session-rooted) when the wizard set it, else the
    // pack-relative fallback that resolves ../../ up to the pack root.
    workspace: plan.workspace ?? `${sessionRel}/repos`,
    // Declarative remediation policy (Epic 04 / 0019/D3) consumed by the
    // `apply_rules` (0032/D5) and `remediate` nodes. Absolute when the wizard
    // set it, else pack-relative from the .runs/wizard scratch dir. Not
    // session-scoped.
    policyPath: plan.policyPath ?? "../../configs/policy/remediation-policy.yaml",
    // Decision log (0032/D1): the run's JSONL audit trail — one line per
    // candidacy / policy / ladder-rung / writer / outcome / contract decision.
    // PACK-OWNED (render-path seam): `steps/output.mjs` roots this — and
    // `reportsBaseDir` / `testsDir` below — at `<session>/<package>/.harness`.
    // The pack-relative fallback here answers only for a plan built WITHOUT a
    // wizard walk (tests, the correction loop); it resolves against the
    // materialized yaml in `.runs/wizard/`, i.e. into this vendored pack.
    decisionLogPath: plan.decisionLogPath ?? `${sessionRel}/decision.jsonl`,
    // Fingerprint artifact (step 7): written next to the clones under the same
    // session root. Absolute when the wizard set it, else the pack-relative
    // fallback that matches the workspace's `../../.harness/<id>` sibling.
    fingerprintsDir: plan.fingerprintsDir ?? sessionRel,
    fingerprintsFilename: plan.fingerprintsFilename ?? "fingerprints.json",
    // Integrated manifest artifact (step 8): the LLM-scan output, written under
    // the same session root as the clones and fingerprints.
    integratedDir: plan.integratedDir ?? sessionRel,
    integratedFilename: plan.integratedFilename ?? "integrated.json",
    // Filesystem snapshot artifacts (step 9): one per-repo `<reponame>.repo.json`
    // inventory under `<session>/snapshots`. `snapshotsSuffix` is the
    // `<repo>.<suffix>` filename tail (spec: repo.json).
    snapshotsDir: plan.snapshotsDir ?? `${sessionRel}/snapshots`,
    snapshotsSuffix: plan.snapshotsSuffix ?? "repo.json",
    // Install stage (step 10, record 0026): the declarative playbook tree is
    // committed source inside the pack (same rooting as `policyPath`), while
    // the raw install logs are session-scoped artifacts this run writes.
    playbooksDir: plan.playbooksDir ?? "../../configs/playbooks/ecosystem-installation",
    installsDir: plan.installsDir ?? `${sessionRel}/installs`,
    // Build stage (step 13, record 0029/D1): the committed BUILD playbook tree
    // inside the pack (not session-scoped — committed source, same rooting as
    // `playbooksDir`), while the raw build logs are session-scoped artifacts.
    buildPlaybooksDir: plan.buildPlaybooksDir ?? "../../configs/playbooks/ecosystem-build",
    buildsDir: plan.buildsDir ?? `${sessionRel}/builds`,
    // Test stage (capability 1): the committed TEST playbook tree (committed
    // source, same rooting as buildPlaybooksDir) + session-scoped raw test logs.
    testPlaybooksDir: plan.testPlaybooksDir ?? "../../configs/playbooks/ecosystem-test",
    testsDir: plan.testsDir ?? `${sessionRel}/tests`,
    // Remediation reports (capability 7): the per-repo markdown + aggregate JSON
    // land under the session artifact root (the atom writes reports/ beneath it).
    reportsBaseDir: plan.reportsBaseDir ?? sessionRel,
    // HTML report (capability 8): the single HTML page sits beside the JSON
    // summary in the run out dir (`outDir`); only its filename is separate.
    htmlFilename: plan.htmlFilename ?? "repo-remediation.html",
    // Dependency-graph stage (step 10, record 0017): the per-repo sub-langgraph
    // config plus the aggregate report artifact. The config fallback resolves
    // from the .runs/wizard scratch dir back to the committed child flow (not
    // session-scoped); the wizard overrides both with absolute paths.
    depgraphConfig: plan.depgraphConfig ?? "../../configs/flows/dependency-graph.yaml",
    depgraphDir: plan.depgraphDir ?? sessionRel,
    depgraphFilename: plan.depgraphFilename ?? "dependency-graph.json",
    // Run-wide error ledger (run-health-and-errors-log Epic 02): the FALLBACK
    // TWIN of outputStep's errorsDir — the half whose omission re-opened 0043
    // and 0046. Prefer the plan's own (absolute) sessionDir over the bare
    // `../../` sentinel so a wizard-less plan that pinned its session still
    // lands the file inside it; the sessionRel rung answers only for the
    // fully-defaulted test/correction-loop path, same as every field above.
    errorsDir: plan.errorsDir ?? plan.sessionDir ?? sessionRel,
    errorsFilename: plan.errorsFilename ?? "errors.logs",
    // Final applied-changes export (step 18¾): the FALLBACK TWIN of outputStep's
    // finalChangesDir — the half whose omission is what re-opened 0043/0046 for
    // errors.logs. Same ladder: the plan's own absolute session dir before the
    // bare `../../` sentinel, so a wizard-less plan that pinned its session still
    // lands the export inside it.
    finalChangesDir: plan.finalChangesDir ?? (plan.sessionDir ? `${plan.sessionDir}/final_applied_changes` : `${sessionRel}/final_applied_changes`),
    name: plan.name ?? "wizard-flow",
  };
}
