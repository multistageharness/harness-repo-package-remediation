/**
 * commands.resolveDatasource — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml). Record 0065.
 *
 * THE FIELD-RESOLUTION SEAM. `dependency_scope` and `manifest_path` are optional
 * columns. This stage resolves them ONCE, against the clone on disk, so every
 * downstream consumer (`plan`, `apply_rules`, `remediate`, contract C1) reads the
 * same answer and cannot disagree:
 *
 *     Provided wins.  Absent derives.  Underivable blocks — it never guesses.
 *
 * WHY A STAGE, not an inference inside `remediate`. `plan` runs FIRST and already
 * branches on strategy (`strategyFor` → `selectTool`). Inferring downstream in
 * `remediate` would leave the PLAN — the artifact a human reads, and the one 0032
 * made authoritative — still carrying the wrong strategy. Only the outcome would
 * be right, not the plan. Resolution belongs before planning.
 *
 * Placement: after `fingerprint` (needs the clones on disk) and before `plan`
 * (must stamp rows before anything reads `dataset` for planning). Node id
 * `resolve_datasource`, NOT `dataset` — LangGraph forbids a node named after a
 * channel (the constraint that named `preflight` beside `registry_preflight` in
 * 0063, and `health` beside `service_health`).
 *
 * Per row:
 *   manifest_path  provided → verbatim, never second-guessed (a manifest that does
 *                             not declare the package is a DATASET contradiction and
 *                             must survive to C1, not be repaired here).
 *                  absent   → the manifest(s) DECLARING the package, from a bounded
 *                             recursive manifest read. Declared in none → resolved
 *                             TRANSITIVE and no manifest is needed (the pin writer
 *                             owns its own target file). Declared in SEVERAL → the
 *                             row FANS OUT, one per declaring manifest.
 *   dependency_scope provided → authoritative, full stop.
 *                  absent   → derived from the above (declared ⇒ direct,
 *                             declared-nowhere ⇒ transitive).
 *                  underivable (clone failed / no readable manifest) → null +
 *                             `unresolved`, which BLOCKS the row downstream. It is
 *                             never silently direct-bumped — that was the 0065 bug.
 *
 * Mock seam (platform rule 3, offline acceptance contract): under `ctx.options.mock`
 * this is a pure deterministic pass-through — supplied values kept, provenance
 * stamped `mock`, no fs/subprocess/network — so the flow still runs end-to-end
 * offline. (`remediate` short-circuits to stub records under mock anyway.)
 *
 * The trust boundary restricts the MAPPING MODULE path (this file lives under
 * `configs/patterns/`, satisfied); it does not restrict this module's own relative
 * imports, which resolve inside the pack.
 */

import { access } from "node:fs/promises";

import { createDecisionLogger } from "../../src/decision-log.mjs";
import { extractManifestDependencies } from "../../src/manifest-deps.mjs";
import { normalizeRepoUrl } from "../../src/repo-url.mjs";
import { resolveRow } from "../../src/datasource-resolve.mjs";

export const meta = {
  name: "commands.resolveDatasource",
  category: "commands",
  summary:
    "Resolve each dataset row's dependency_scope + manifest_path — supplied values win, absent values are derived from the clone's manifests, underivable rows are marked unresolved (never guessed).",
  params: {
    type: "object",
    required: ["dataset_from", "clones_from", "into"],
    properties: {
      dataset_from: { type: "string", minLength: 1 },
      clones_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      decision_log: { type: "string", minLength: 1 },
      /** Cap on the multi-module fan-out per row. A truncated fan-out NAMES what it dropped (0025/A3). */
      max_fanout: { type: "number", minimum: 1 },
    },
  },
  returns: "node",
};

const MAX_FANOUT_DEFAULT = 25;

export function resolveDatasource(params, ctx) {
  let logger = null;
  return async (state) => {
    const dataset = state[params.dataset_from] ?? {};
    const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
    const clones = Array.isArray(state[params.clones_from]) ? state[params.clones_from] : [];
    const maxFanout = Number.isFinite(params.max_fanout) ? params.max_fanout : MAX_FANOUT_DEFAULT;

    if (logger === null) {
      const logRel = params.decision_log ?? null;
      const { isAbsolute, resolve } = await import("node:path");
      logger = createDecisionLogger({
        path: logRel === null ? null : isAbsolute(logRel) ? logRel : resolve(ctx.options.baseDir, logRel),
        mock: ctx.options.mock === true,
        stage: "resolve-datasource",
      });
    }
    const log = (fields) => logger.log(fields);

    // ── Mock: pure pass-through. Supplied values kept, provenance stamped. ──
    if (ctx.options.mock === true) {
      const resolved = rows.map((row) => ({
        ...row,
        scope_source: "mock",
        manifest_source: "mock",
      }));
      await log({ decision: "resolve-summary", rows: rows.length, resolved: resolved.length, derived: 0, unresolved: 0 });
      return { [params.into]: { ...dataset, rows: resolved } };
    }

    // ── Evidence: one bounded recursive manifest read per clone, cached. ──────
    // `recurseSubmodules` (0032/D3) is what lets a multi-module repo with NO root
    // manifest (multi-repo-npm: only repo-a/ and repo-b/) be seen at all. Before
    // 0065 no caller ever passed it, so such a repo carried ZERO deps.
    const evidenceByUrl = new Map();
    for (const clone of clones) {
      const url = normalizeRepoUrl(clone?.url) ?? clone?.url ?? null;
      if (url === null || evidenceByUrl.has(url)) continue;
      const dir = typeof clone?.dir === "string" && clone.dir.length > 0 ? clone.dir : null;
      if (clone?.failed === true || dir === null) {
        evidenceByUrl.set(url, { dependencies: [], resolvable: false, cause: "clone failed" });
        continue;
      }
      const exists = await access(dir).then(() => true, () => false);
      if (!exists) {
        evidenceByUrl.set(url, { dependencies: [], resolvable: false, cause: "clone directory missing" });
        continue;
      }
      const { dependencies } = await extractManifestDependencies(dir, { recurseSubmodules: true });
      // A repo with no KNOWN manifest is not "everything is transitive" — it is
      // unreadable. Absence of a declaration proves nothing there, so refuse to infer.
      const manifests = new Set(dependencies.map((d) => d?.manifestPath).filter(Boolean));
      evidenceByUrl.set(url, {
        dependencies,
        resolvable: manifests.size > 0,
        cause: manifests.size > 0 ? null : "no readable manifest in this repo",
      });
    }

    // ── Resolve each row (fanning out multi-module declarations) ─────────────
    const out = [];
    let derived = 0;
    let unresolved = 0;
    for (const row of rows) {
      const url = normalizeRepoUrl(row?.repo_url) ?? null;
      const evidence = url !== null ? evidenceByUrl.get(url) ?? null : null;
      const pkg = typeof row?.package === "string" ? row.package.trim() : "";

      // A row with no package is not a remediation candidate at all (the repo-source
      // lanes carry only {repo, repo_url}); pass it through untouched.
      if (pkg === "") {
        out.push(row);
        continue;
      }

      const res = resolveRow({
        pkg,
        suppliedScope: row?.dependency_scope,
        suppliedManifest: row?.manifest_path,
        dependencies: evidence?.dependencies ?? [],
        resolvable: evidence?.resolvable === true,
      });

      if (res.scopeSource === "unresolved") unresolved += 1;
      else if (res.scopeSource !== "dataset") derived += 1;

      // Inference is AUDITABLE, never silent: every non-dataset resolution names
      // the evidence that justified it.
      if (res.scopeSource !== "dataset") {
        await log({
          decision: "scope-resolution",
          repo: url,
          package: pkg,
          scope: res.scope,
          scopeSource: res.scopeSource,
          manifestSource: res.manifestSource,
          manifests: res.manifests,
          reason: res.reason ?? evidence?.cause ?? null,
        });
      }

      const stamp = (manifestPath) => ({
        ...row,
        dependency_scope: res.scope,
        manifest_path: manifestPath,
        scope_source: res.scopeSource,
        manifest_source: res.manifestSource,
        ...(res.scopeSource === "unresolved" ? { unresolved_reason: res.reason ?? evidence?.cause ?? null } : {}),
      });

      // Resolved-transitive (or unresolved): no manifest is needed — emit one row
      // carrying a null manifest_path. That null is a RESOLVED state.
      if (res.manifests.length === 0) {
        out.push(stamp(null));
        continue;
      }
      // Declared in one manifest — the common case.
      if (res.manifests.length === 1) {
        out.push(stamp(res.manifests[0]));
        continue;
      }
      // Multi-module: one row per declaring manifest. A truncated fan-out NAMES
      // what it dropped (0025/A3's contract — never a silent cap).
      const kept = res.manifests.slice(0, maxFanout);
      const dropped = res.manifests.slice(maxFanout);
      for (const manifestPath of kept) out.push(stamp(manifestPath));
      await log({ decision: "fanout", repo: url, package: pkg, manifests: kept.length, dropped: dropped.length });
      if (dropped.length > 0) {
        await log({ decision: "fanout-truncated", repo: url, package: pkg, max: maxFanout, dropped });
      }
    }

    await log({ decision: "resolve-summary", rows: rows.length, resolved: out.length, derived, unresolved });
    return { [params.into]: { ...dataset, rows: out } };
  };
}
