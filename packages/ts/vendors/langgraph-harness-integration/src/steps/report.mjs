/**
 * steps/report.mjs — turn the remediation run state into the user-facing
 * outcome: the deduped repo set, one clone result per repo (mock or real), and
 * the written artifact path. The orchestrator maps the run status to the process
 * exit code separately; this step only renders.
 *
 * Change record 0021/D4 adds one obligation: a PLACEHOLDER ingest lane drives an
 * empty but GREEN run (`dataset.repos: []`, zero clones, zero remediations),
 * which is indistinguishable from "this repo set is clean" unless we say so. So
 * we print an explicit `placeholder — no rows ingested` warning.
 *
 * The repo-source lanes get a NOTE, not a warning (record 0023/A1). They ingest
 * the single array `[{repo, repo_url}]` and carry no `package` /
 * `recommended_version`, but they DO remediate — off the fingerprint's extracted
 * dependencies, with registry-resolved targets. The line names where the targets
 * came from rather than claiming (as 0021/A5 wrongly did) that nothing was bumped.
 */
import { isPlaceholderLane, isRepoSourceLane } from "../ingest-lanes.mjs";

/**
 * Clone failures are recorded as DATA, never thrown (0019/A1), so the executor's
 * own error count is 0 and the run's status stays "completed". That is right for
 * the graph and wrong for the operator: a run that cloned nothing must not print
 * "Done." and exit 0. The wizard gates its exit code on this; the report names
 * each failure inline.
 * @param {object} state the finished run state
 * @returns {Array<object>} the clone_results entries that failed
 */
export function failedClones(state) {
  const results = state?.clone_results;
  return Array.isArray(results) ? results.filter((c) => c?.failed === true) : [];
}

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 * @param {{status: string, state: object}} result
 * @param {object} flowPlan the built FlowPlan (for the requested column/mode)
 */
export function presentReport(ctx, result, flowPlan) {
  const {
    rows = [],
    dataset = {},
    clone_results = [],
    fingerprints = [],
    integrated = [],
    remediations = [],
    snapshots = [],
    installs = [],
    dependency_graphs = [],
    report = {},
    fingerprints_report = {},
    integrated_report = {},
    dependency_graph_report = {},
  } = result.state ?? {};
  const repos = Array.isArray(dataset.repos) ? dataset.repos : [];

  const failures = failedClones(result.state ?? {});

  const clones =
    clone_results.length === 0
      ? ["  (none)"]
      : clone_results.map((c, i) => {
          // A failed clone used to render as a bare "[?]" — the same glyph an
          // unknown-but-harmless state gets. Name the class, and echo the url git
          // was actually given (it may differ from the canonical dedup key).
          if (c?.failed) {
            const via = c?.clone_url && c.clone_url !== c?.url ? ` via ${c.clone_url}` : "";
            return `  ${i + 1}. ${c?.url ?? "(no url)"}${via} → FAILED [${c?.errorClass ?? "unknown"}] after ${c?.attempts ?? "?"} attempt(s)`;
          }
          const status = c?.mocked ? "mock" : c?.cloned ? "cloned" : c?.existed ? "exists" : "?";
          return `  ${i + 1}. ${c?.url ?? "(no url)"} → ${c?.dir ?? "(no dir)"} [${status}]`;
        });

  // Per-repo integrated manifest lines surface the confidence bucket and its
  // reason (change record 0007 D1) so a low/medium verdict is debuggable from
  // the run output, not just by opening integrated.json.
  const integratedLines =
    integrated.length === 0
      ? ["  (none)"]
      : integrated.map((m, i) => {
          const eco = m?.ecosystem ?? "unknown";
          const bucket = m?.confidence ?? "?";
          // Drop a leading "<bucket> — " the reason already carries so the line
          // doesn't read "confidence=medium — medium — …" (the deterministic
          // stub/degrade reasons lead with the bucket by design).
          const raw = typeof m?.confidenceReason === "string" ? m.confidenceReason : "";
          const trimmed = raw.startsWith(`${bucket} — `) ? raw.slice(`${bucket} — `.length) : raw;
          const reason = trimmed ? ` — ${trimmed}` : "";
          return `  ${i + 1}. ${m?.url ?? "(no url)"} [${eco}] confidence=${bucket}${reason}`;
        });

  const artifact = report?.path
    ? `Report artifact: ${report.path}${report.written === false ? " (not written)" : ""}`
    : "Report artifact: (none)";

  const fingerprintArtifact = fingerprints_report?.path
    ? `Fingerprints artifact: ${fingerprints_report.path}${fingerprints_report.written === false ? " (not written)" : ""}`
    : "Fingerprints artifact: (none)";

  const integratedArtifact = integrated_report?.path
    ? `Integrated artifact: ${integrated_report.path}${integrated_report.written === false ? " (not written)" : ""}`
    : "Integrated artifact: (none)";

  // Step 9 (langgraph-flow.md): per-repo snapshots are one file each, not a
  // single report — surface the count and the directory they landed in.
  const snapshotWritten = snapshots.filter((s) => s?.written !== false).length;
  const snapshotDir = flowPlan?.snapshotsDir ?? (snapshots[0]?.path ? snapshots[0].path.replace(/\/[^/]+$/, "") : null);
  const snapshotArtifact = snapshotDir
    ? `Snapshots artifact: ${snapshotWritten} file(s) under ${snapshotDir}`
    : "Snapshots artifact: (none)";

  // Step 10 (record 0017): the aggregate per-repo
  // dependency graphs land in one dependency-graph.json next to the fingerprints.
  const depgraphArtifact = dependency_graph_report?.path
    ? `Dependency-graph artifact: ${dependency_graph_report.path}${dependency_graph_report.written === false ? " (not written)" : ""}`
    : "Dependency-graph artifact: (none)";

  // Step 2 (0021): an empty run must never read as a clean one. Both lines are
  // printed BEFORE the report block so they can't scroll past unnoticed.
  const source = flowPlan?.ingestSource;
  if (isPlaceholderLane(source) && rows.length === 0) {
    ctx.prompt.warn(
      `placeholder — no rows ingested: the '${source}' lane is a stub (0021/D4). ` +
        `Zero repos, zero clones, and zero remediations below are the LANE's doing, not a clean repo set.`,
    );
  } else if (isRepoSourceLane(source)) {
    // Counts, not a claim: under mock every record is a `mock run` stub; on a
    // real run each extracted dependency is a candidate with a registry target.
    const applied = remediations.filter((r) => r?.applied === true).length;
    const skips = remediations.filter((r) => r?.skipReason).length;
    ctx.prompt.note(
      `The '${source}' lane ingested the single array [${source}] — one row of {repo, repo_url}, no package/recommended_version columns, ` +
        `so step 3 (dataset_init → select_headers) was skipped.\n` +
        `remediate still ran, over the dependencies the fingerprint stage extracted, with each target resolved from the registry: ` +
        `${remediations.length} record(s) — ${applied} applied, ${skips} skipped (0019/A3: every skip is recorded, never dropped).`,
      "repo-source ingest",
    );
  }

  if (failures.length > 0) {
    // GitHub answers an unauthenticated fetch of a PRIVATE repo with
    // "Repository not found" — a 403 wearing a 404's clothes. Say so, rather than
    // leaving the operator to conclude the repo doesn't exist.
    const maybeAuth = failures.some(
      (c) => (c?.errorClass === "not_found" || c?.errorClass === "auth_required") && /^https:\/\//i.test(String(c?.clone_url ?? "")),
    );
    ctx.prompt.warn(
      `${failures.length} of ${clone_results.length} clone(s) FAILED — nothing was written to the repos/ directory for them, ` +
        `and no dependency was remediated.\n` +
        (maybeAuth
          ? `At least one failure was an unauthenticated https fetch. GitHub reports a PRIVATE repo as "Repository not found", ` +
            `so 'not_found' here may mean 'no credentials'. Supply the repo over SSH (git@host:owner/repo.git) to use your key.`
          : `See errorDetail in the report artifact for each failure's git stderr.`),
      "clone failures",
    );
  }

  const body = [
    `Run status: ${result.status}${failures.length > 0 ? ` (${failures.length} clone failure(s))` : ""}`,
    `Mode: ${flowPlan?.mock === false ? "real (native git)" : "mock (offline)"}`,
    `Ingest source: ${source ?? "(unknown)"}`,
    `Ingested rows: ${rows.length}`,
    `Repo column: ${flowPlan?.repoColumn ?? "(unknown)"}`,
    `Unique repos: ${repos.length}`,
    "Clones:",
    ...clones,
    `Fingerprinted repos: ${fingerprints.length}`,
    `Integrated repos: ${integrated.length}`,
    ...integratedLines,
    `Snapshotted repos: ${snapshots.length}`,
    // Step 10 (record 0026): a non-zero exit is a RECORDED outcome — surface
    // the ok/failed/skipped split rather than a bare count.
    `Installs: ${installs.length} record(s) — ${installs.filter((r) => r?.status === "ok").length} ok, ` +
      `${installs.filter((r) => r?.status === "failed").length} failed, ` +
      `${installs.filter((r) => r?.status === "skipped").length} skipped`,
    `Dependency graphs: ${dependency_graphs.length}`,
    artifact,
    fingerprintArtifact,
    integratedArtifact,
    snapshotArtifact,
    depgraphArtifact,
  ].join("\n");
  ctx.prompt.note(body, "Remediation report");
}
