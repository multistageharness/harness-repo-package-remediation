/**
 * src/render-flow.mjs — emit a concrete flow yaml from a FlowPlan by DERIVING
 * it from the committed configs/flows/repo-remediation.yaml (change record
 * 0022/A1 — the dual-maintenance seam 0020 recorded is CLOSED).
 *
 * Until 0022 this module was a SECOND, hand-maintained realization of the flow
 * topology: it re-typed every state channel, node, and edge the committed yaml
 * already declares, and a change landing in only one realization silently
 * no-oped in the other (0020/A1's "the feature never ran" bug class). Now the
 * committed yaml — the same file `langgraph-langchain-harness validate` / `langgraph-langchain-harness graph` and the
 * acceptance test consume — is the single topology source of truth:
 *
 *   1. `buildFlowObject` loads + parses the committed yaml (raw, pre-env-
 *      interpolation) from the pack directory (platform rule 6 — resolved
 *      against PKG_DIR, never the invocation cwd).
 *   2. It overlays ONLY the wizard-collected values enumerated in `OVERLAYS` —
 *      a CLOSED, NAMED ALLOWLIST (0022/A1.4). Anything not on it is taken from
 *      the yaml verbatim. Adding an entry is itself a change record.
 *   3. Nodes, edges, state channels, and reducers are NEVER re-typed here.
 *
 * The drift gate in test/render-flow.test.mjs (0022/D1) asserts the rendered
 * flow is structurally equal to the committed flow modulo `OVERLAYS`, so a
 * hand-authored divergence cannot be reintroduced silently.
 *
 * No YAML dependency is resolvable from this pack, so parsing reuses the
 * vendored SDK loader's own `parseFlowConfig` (via src/sdk.mjs — the reader
 * that must parse this exact file at run time anyway; 0022 open item 1), and
 * serialization keeps the hand-rolled deterministic emitter below. The emitter
 * emits a strict, quoted subset the SDK loader parses back losslessly (proven
 * end-to-end by the wizard e2e test).
 *
 * File/dir paths (input, out_dir, workspace) carry through from the FlowPlan.
 * The wizard roots them at the invocation cwd, so they render ABSOLUTE and the
 * loader's `baseDir` resolution (relative to the scratch yaml's own directory)
 * finds them wherever the yaml is written. When a caller builds a plan without
 * overrides (e.g. tests), the FlowPlan fallbacks are pack-relative with the
 * same ../../ depth from both the hand-written flow dir (configs/flows/) and
 * the scratch dir (.runs/wizard/), and session-scoped where they are artifacts
 * this run writes (0024).
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFlowConfig } from "./sdk.mjs";

/** The pack root — the trust boundary the committed flow is resolved inside. */
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMITTED_FLOW_PATH = join(PKG_DIR, "configs", "flows", "repo-remediation.yaml");

/**
 * Load the committed flow yaml as a RAW document — parsed, but before env
 * interpolation (`${MOCK:true}` and friends stay literal) and before loader
 * normalization (no injected channels, no defaulted fields). A fresh parse per
 * call so overlay mutation never aliases across builds.
 */
export function loadCommittedFlowDoc() {
  const text = readFileSync(COMMITTED_FLOW_PATH, "utf8");
  return parseFlowConfig(text, { path: COMMITTED_FLOW_PATH, dir: dirname(COMMITTED_FLOW_PATH) }).raw;
}

/**
 * THE OVERLAY ALLOWLIST (0022/A1.4) — the sole legitimate per-run differences
 * between the committed flow and a wizard-materialized one. Each entry names
 * the exact path it overlays (`nodes.<id>` addresses a node by id) and the
 * FlowPlan field that supplies the value. Everything else in the yaml flows
 * through verbatim. Adding an entry here is a licensed divergence and needs
 * its own change record.
 */
export const OVERLAYS = Object.freeze([
  { path: ["name"], value: (p) => p.name },
  // the wizard's run-mode gate (real by default; mock via the test seam)
  { path: ["runtime", "mock"], value: (p) => p.mock === true },
  // step 2 (0021/A1+A4): the ingest orchestrator's two channel seeds
  { path: ["state", "ingest_source", "default"], value: (p) => p.ingestSource },
  { path: ["state", "ingest_ref", "default"], value: (p) => p.ingestRef ?? "" },
  // child-config paths, absolutized against the pack (0020/A1.3, 0021/A4)
  { path: ["nodes", "ingest", "with", "config"], value: (p) => p.ingestConfig },
  { path: ["nodes", "dependency_graph", "with", "config"], value: (p) => p.depgraphConfig },
  // wizard-collected dataset shaping
  { path: ["nodes", "select_headers", "with", "columns"], value: (p) => (p.selectedHeaders ?? []).slice() },
  { path: ["nodes", "collect_repos", "with", "column"], value: (p) => p.repoColumn },
  // session-scoped artifact roots (0024/A1)
  { path: ["nodes", "clone_repo", "with", "workspace"], value: (p) => p.workspace },
  { path: ["nodes", "fingerprint_report", "with", "out_dir"], value: (p) => p.fingerprintsDir },
  { path: ["nodes", "fingerprint_report", "with", "filename"], value: (p) => p.fingerprintsFilename },
  { path: ["nodes", "integrate_report", "with", "out_dir"], value: (p) => p.integratedDir },
  { path: ["nodes", "integrate_report", "with", "filename"], value: (p) => p.integratedFilename },
  { path: ["nodes", "remediate", "with", "policy_path"], value: (p) => p.policyPath },
  // package-rules stage (0032/D5+A7): same policy file as remediate; the
  // decision log is a session-scoped artifact (0032/D1) shared by every
  // deciding node.
  { path: ["nodes", "apply_rules", "with", "policy_path"], value: (p) => p.policyPath },
  { path: ["nodes", "apply_rules", "with", "decision_log"], value: (p) => p.decisionLogPath },
  { path: ["nodes", "remediate", "with", "decision_log"], value: (p) => p.decisionLogPath },
  { path: ["nodes", "validate", "with", "decision_log"], value: (p) => p.decisionLogPath },
  // 0065/D1: resolve_datasource is a DECIDING node too — it must write into the
  // same session-scoped decision log, not the literal `../../.harness` in the
  // yaml (which would escape into the vendor dir — the 0046/0048 scatter).
  { path: ["nodes", "resolve_datasource", "with", "decision_log"], value: (p) => p.decisionLogPath },
  { path: ["nodes", "snapshot", "with", "out_dir"], value: (p) => p.snapshotsDir },
  { path: ["nodes", "snapshot", "with", "name_suffix"], value: (p) => p.snapshotsSuffix },
  // install stage (0026/A1+D1): committed playbook tree + session-scoped logs
  { path: ["nodes", "install", "with", "playbooks_dir"], value: (p) => p.playbooksDir },
  { path: ["nodes", "install", "with", "save_dir"], value: (p) => p.installsDir },
  // install-verify stage (0027/A1+D1): reads the SAME session-scoped install log
  // root the install stage writes, so it verifies THIS run's logs, not the
  // committed non-session default.
  { path: ["nodes", "install_verify", "with", "save_dir"], value: (p) => p.installsDir },
  // build stage (0029/D1): committed BUILD playbook tree + session-scoped logs
  { path: ["nodes", "build", "with", "playbooks_dir"], value: (p) => p.buildPlaybooksDir },
  { path: ["nodes", "build", "with", "save_dir"], value: (p) => p.buildsDir },
  // build-snapshot stage (0029/D2): the SAME session-scoped snapshots root as
  // step 9 — the 0029/A1 phase sub-dirs (initial/, build/) disambiguate.
  { path: ["nodes", "build_snapshot", "with", "out_dir"], value: (p) => p.snapshotsDir },
  { path: ["nodes", "build_snapshot", "with", "name_suffix"], value: (p) => p.snapshotsSuffix },
  { path: ["nodes", "depgraph_report", "with", "out_dir"], value: (p) => p.depgraphDir },
  { path: ["nodes", "depgraph_report", "with", "filename"], value: (p) => p.depgraphFilename },
  // test stage (capability 1): committed TEST playbook tree + session-scoped logs
  { path: ["nodes", "run_test", "with", "playbooks_dir"], value: (p) => p.testPlaybooksDir },
  { path: ["nodes", "run_test", "with", "save_dir"], value: (p) => p.testsDir },
  // remediation reports (capability 7): per-repo md + aggregate under the session root
  { path: ["nodes", "remediation_report", "with", "out_dir"], value: (p) => p.reportsBaseDir },
  { path: ["nodes", "render", "with", "out_dir"], value: (p) => p.outDir },
  { path: ["nodes", "render", "with", "filename"], value: (p) => p.filename },
  // html report (capability 8): beside the JSON summary in the run out dir
  { path: ["nodes", "html_report", "with", "out_dir"], value: (p) => p.outDir },
  { path: ["nodes", "html_report", "with", "filename"], value: (p) => p.htmlFilename },
  // terminal errors stage (run-health-and-errors-log Epic 02): errors.logs is
  // SESSION-rooted. The committed flow deliberately carries NO out_dir on the
  // errors node (a `../../` literal there is the 0043/0046 scatter vector), so
  // this overlay CREATES the key at materialize time from the render seam.
  { path: ["nodes", "errors", "with", "out_dir"], value: (p) => p.errorsDir },
  { path: ["nodes", "errors", "with", "filename"], value: (p) => p.errorsFilename },
  // final applied-changes export (step 18¾): SESSION-rooted, same discipline as
  // errors — the committed flow carries no out_dir on the node, so this overlay
  // CREATES the key at materialize time from the render seam.
  { path: ["nodes", "export_changes", "with", "out_dir"], value: (p) => p.finalChangesDir },
]);

/**
 * Set one overlay path on a raw flow doc. `["nodes", <id>, ...]` addresses the
 * node by id — positional indexes would silently re-point when a change record
 * inserts a node. Throws on a missing node/segment: an overlay that no longer
 * lands is a drifted allowlist, not a soft no-op.
 */
export function setFlowValue(doc, path, value) {
  let target = doc;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (seg === "nodes") {
      const id = path[++i];
      target = (target.nodes ?? []).find((n) => n?.id === id);
      if (!target) throw new Error(`overlay path names unknown node '${id}' — allowlist drifted from the committed flow`);
      continue;
    }
    target = target?.[seg];
    if (target == null) throw new Error(`overlay path '${path.join(".")}' missing in the committed flow at '${seg}'`);
  }
  target[path[path.length - 1]] = value;
}

/**
 * Build the flow object for `flowPlan`: the committed flow, overlaid. Key
 * order is the committed document's own order, so the rendered yaml is
 * stable/snapshotable.
 * @param {import("./flow-plan.mjs").buildFlowPlan extends (...a:any)=>infer R ? R : any} flowPlan
 */
export function buildFlowObject(flowPlan) {
  const doc = loadCommittedFlowDoc();
  for (const overlay of OVERLAYS) {
    setFlowValue(doc, overlay.path, overlay.value(flowPlan));
  }
  return doc;
}

/**
 * @param {object} flowPlan a built FlowPlan (see flow-plan.mjs)
 * @returns {string} the rendered flow yaml
 */
export function renderFlowYaml(flowPlan) {
  return `${emit(buildFlowObject(flowPlan), 0)}\n`;
}

// ── minimal deterministic YAML emitter ───────────────────────────────────────

/** Emit an object's key/value block at `indent` spaces. */
function emit(obj, indent) {
  const pad = " ".repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    lines.push(emitEntry(pad, key, value, indent));
  }
  return lines.join("\n");
}

function emitEntry(pad, key, value, indent) {
  if (isScalar(value)) return `${pad}${key}: ${scalar(value)}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}${key}: []`;
    if (value.every(isScalar)) return `${pad}${key}: [${value.map(scalar).join(", ")}]`;
    // array of objects → block sequence
    const items = value.map((item) => emitSeqItem(pad, item, indent)).join("\n");
    return `${pad}${key}:\n${items}`;
  }
  // nested object
  if (Object.keys(value).length === 0) return `${pad}${key}: {}`;
  return `${pad}${key}:\n${emit(value, indent + 2)}`;
}

/** Emit one `- ...` block-sequence item (an object). */
function emitSeqItem(pad, item, indent) {
  const body = emit(item, indent + 2).split("\n");
  // Replace the leading pad of the first line with the "- " dash marker.
  const dashPad = `${pad}- `;
  body[0] = dashPad + body[0].slice(indent + 2);
  return body.join("\n");
}

function isScalar(v) {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function scalar(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  // Quote every string for safety (handles ':', '{{ }}', spaces, dots, slashes).
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
