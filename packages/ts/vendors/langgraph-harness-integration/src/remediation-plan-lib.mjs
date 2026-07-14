/**
 * src/remediation-plan-lib.mjs — the PURE, deterministic core of the
 * remediation-plan stage (langgraph-flow.md capability 4a). Given one repo's
 * captured evidence (fingerprint + extracted dependencies) and its inputted
 * vulnerability data (the dataset rows matched to that repo), it produces a
 * stable, ordered per-repo remediation plan — the same inputs always yield the
 * same plan.
 *
 * No I/O, no network, no model, no clock — so it unit-tests directly and behaves
 * identically under `--mock` and on real runs. The inputted vulnerability data
 * (the CSV dataset) is REAL even under mock, so the plan carries real CVEs,
 * packages, severities, and target versions regardless of run mode.
 *
 * The atom (`configs/patterns/remediation-plan.mjs`) owns the state-channel
 * iteration, the repo↔row matching, and loading the tool + skill registries; this
 * module owns the join, the strategy/tool selection, and the deterministic order.
 */

import { resolveRow } from "./datasource-resolve.mjs";

/** Dataset `ecosystem` token (as it appears in a dependabot CSV) → lane group. */
export const DATASET_ECOSYSTEM_TO_GROUP = Object.freeze({
  npm: "node",
  yarn: "node",
  pnpm: "node",
  pip: "python",
  poetry: "python",
  uv: "python",
  maven: "java",
  gradle: "java",
  go: "golang",
  gomod: "golang",
  docker: "docker",
});

/** Per-group remediation SKILL to reference (capability 3 wiring). */
export const SKILL_FOR_GROUP = Object.freeze({
  node: "npm-remediation",
  python: "pip-remediation",
  java: "maven-remediation",
  golang: "golang-remediation",
});

/** datasource on an extracted dependency record → lane group. */
const DATASOURCE_TO_GROUP = { npm: "node", go: "golang", pypi: "python", maven: "java" };

/** Severity ordering — lower rank sorts first (critical is most urgent). */
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, moderate: 2, low: 3 };

export function severityRank(severity) {
  const key = typeof severity === "string" ? severity.toLowerCase() : "";
  return Object.hasOwn(SEVERITY_RANK, key) ? SEVERITY_RANK[key] : 4;
}

/** Map a dataset ecosystem token to a lane group, or null. */
export function datasetEcosystemGroup(token) {
  const key = typeof token === "string" ? token.toLowerCase().trim() : "";
  return DATASET_ECOSYSTEM_TO_GROUP[key] ?? null;
}

const nonEmpty = (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

/**
 * Read one dataset row into a normalized vulnerability record. Tolerant of
 * missing columns (the repo-source lanes carry only {repo, repo_url}).
 */
export function rowToVulnerability(row) {
  return {
    package: nonEmpty(row?.package),
    ecosystem: nonEmpty(row?.ecosystem),
    severity: nonEmpty(row?.severity)?.toLowerCase() ?? null,
    cveId: nonEmpty(row?.cve_id),
    ghsaId: nonEmpty(row?.ghsa_id),
    scope: nonEmpty(row?.dependency_scope),
    state: nonEmpty(row?.state)?.toLowerCase() ?? null,
    currentVersion: nonEmpty(row?.current_version),
    recommendedVersion: nonEmpty(row?.recommended_version),
    firstPatchedVersion: nonEmpty(row?.first_patched_version),
    vulnerableRange: nonEmpty(row?.vulnerable_version_range),
    manifestPath: nonEmpty(row?.manifest_path),
    summary: nonEmpty(row?.summary),
    // 0065/D2 — provenance stamped by `commands.resolveDatasource`, so a DERIVED
    // field is never mistaken for a dataset fact (and C1 can tell a terse input
    // from a wrong one).
    scopeSource: nonEmpty(row?.scope_source),
    manifestSource: nonEmpty(row?.manifest_source),
  };
}

/**
 * Deterministic strategy from a vulnerability's RESOLVED dependency scope.
 *
 * 0065/A1 — this is a THREE-valued input (`direct` / `transitive` / unresolved),
 * and it must stay a three-way function. It used to be
 * `scope === "transitive" ? "transitive-pin" : "direct-bump"`, whose `else` branch
 * collapsed an UNRESOLVED scope into `direct-bump` — asserting a fact nobody
 * supplied, and biased toward the strictly more fragile lane (a wrong direct-bump
 * fails loudly because the token is not in the manifest; the pin lane needs no
 * declared token). That default skipped 6 of 12 findings whenever the input CSV
 * omitted `dependency_scope`.
 *
 * `null` means "not resolved" and BLOCKS the row downstream — it is never guessed.
 * Do not reintroduce a two-branch ternary here or at the `remediate` dispatch.
 */
export function strategyFor(vuln) {
  if (vuln.scope === "transitive") return "transitive-pin";
  if (vuln.scope === "direct") return "direct-bump";
  return null;
}

/**
 * Pick the best tool id for a strategy from the ecosystem's available tools.
 * Ranked, most specific first: (1) an ecosystem tool whose `capabilities` include
 * the strategy AND whose `manifests` include this finding's manifest (so a
 * pom.xml repo picks the maven tool, not the gradle one), (2) an ecosystem tool
 * matching the strategy, (3) an ecosystem tool matching the manifest, (4) any
 * ecosystem tool, (5) a generic capability match, (6) the first available tool.
 */
export function selectTool(tools, strategy, group, manifest = null) {
  const own = tools.filter((t) => t.ecosystem === group);
  const manifestBase = typeof manifest === "string" && manifest.length > 0 ? manifest.split("/").pop() : null;
  const capMatch = (t) => Array.isArray(t.capabilities) && t.capabilities.includes(strategy);
  const manifestMatch = (t) => manifestBase != null && Array.isArray(t.manifests) && t.manifests.includes(manifestBase);
  const pick =
    own.find((t) => capMatch(t) && manifestMatch(t)) ??
    own.find(capMatch) ??
    own.find(manifestMatch) ??
    own[0] ??
    tools.find(capMatch) ??
    tools[0];
  return pick?.id ?? null;
}

/** The skill name to reference for a group, guaranteed to exist in the registry. */
export function skillForGroup(group, skillNames) {
  const preferred = SKILL_FOR_GROUP[group];
  if (preferred && skillNames.includes(preferred)) return preferred;
  if (skillNames.includes("remediation-planning")) return "remediation-planning";
  return skillNames[0] ?? null;
}

/**
 * Resolve a repo's ecosystem group. The inputted vulnerability data wins (it is
 * real even under mock): the most common `ecosystem` across the matched rows.
 * Falls back to the fingerprint's dominant ecosystem, then to the extracted
 * dependencies' datasource, then "other".
 * @param {object[]} vulns normalized vulnerabilities
 * @param {object|null} fingerprint the repo's detection report
 * @param {object[]} dependencies extracted dependency records
 * @param {(id:string)=>(string|null)} ecosystemGroup reverse map from the registry
 */
export function resolveGroup(vulns, fingerprint, dependencies, ecosystemGroup) {
  const counts = new Map();
  for (const v of vulns) {
    const g = datasetEcosystemGroup(v.ecosystem);
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  if (counts.size > 0) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  const dominant = fingerprint?.dominantEcosystem;
  const fromFp = typeof dominant === "string" ? ecosystemGroup(dominant) : null;
  if (fromFp) return fromFp;
  for (const dep of dependencies) {
    const g = DATASOURCE_TO_GROUP[dep?.datasource];
    if (g) return g;
  }
  return "other";
}

/**
 * Build one repo's deterministic remediation plan.
 * @param {{
 *   url: string|null, dir: string|null, fingerprint: object|null,
 *   dependencies: object[], cloneError?: string|null,
 *   rows: object[], tools: object[], skillNames: string[],
 *   ecosystemGroup: (id:string)=>(string|null),
 * }} input
 * @returns {object} the plan record
 */
export function buildRepoPlan(input) {
  const { url, dir, fingerprint, dependencies = [], cloneError = null, rows = [], tools = [], skillNames = [], ecosystemGroup } = input;

  const vulnerabilities = rows.map(rowToVulnerability).filter((v) => v.package || v.cveId || v.ghsaId);
  const group = resolveGroup(vulnerabilities, fingerprint, dependencies, ecosystemGroup);
  const availableTools = tools.map((t) => t.id);
  const skill = skillForGroup(group, skillNames);

  const actions = [];
  const notes = [];

  // Path A — inputted vulnerability data (spreadsheet ingest): one action per
  // open, actionable finding; non-actionable findings are RECORDED as notes.
  for (const vuln of vulnerabilities) {
    if (!vuln.package) {
      notes.push({ kind: "blocked", reason: "vulnerability row has no package", cveId: vuln.cveId });
      continue;
    }
    if (vuln.state && vuln.state !== "open") {
      notes.push({ kind: "skipped", package: vuln.package, reason: `advisory state is '${vuln.state}'` });
      continue;
    }
    const to = vuln.recommendedVersion ?? vuln.firstPatchedVersion;
    if (!to) {
      notes.push({ kind: "blocked", package: vuln.package, reason: "no recommended / first-patched version in the advisory" });
      continue;
    }
    // 0065/A1+D1 — resolve the two optional fields against the fingerprint's
    // manifest-declared dependencies. `commands.resolveDatasource` normally does
    // this upstream and stamps the row (in which case `scope` is already set and
    // `resolveRow` just echoes it back as `dataset`); doing it here too keeps a
    // plan built WITHOUT the stage — unit tests, other flows — correct as well.
    // One shared resolver, so the two callers cannot drift.
    const resolved = resolveRow({
      pkg: vuln.package,
      suppliedScope: vuln.scope,
      suppliedManifest: vuln.manifestPath,
      dependencies,
      resolvable: dependencies.length > 0,
    });
    const strategy = strategyFor({ scope: resolved.scope });
    const manifest = resolved.manifests[0] ?? null;
    // Unresolved scope is BLOCKED, never guessed into a lane (0065/A1).
    if (strategy === null) {
      notes.push({
        kind: "blocked",
        package: vuln.package,
        reason: resolved.reason ?? "dependency scope unresolved",
      });
      continue;
    }
    actions.push({
      package: vuln.package,
      strategy,
      from: vuln.currentVersion,
      to,
      tool: selectTool(tools, strategy, group, manifest),
      manifest,
      severity: vuln.severity,
      cveId: vuln.cveId,
      ghsaId: vuln.ghsaId,
      scope: resolved.scope,
      scopeSource: vuln.scopeSource ?? resolved.scopeSource,
      manifestSource: vuln.manifestSource ?? resolved.manifestSource,
      source: "dataset",
    });
  }

  // Path B — no inputted vulnerabilities (repo-source ingest): plan from the
  // CAPTURED dependencies. Target resolution is deferred to remediate's registry
  // lookup, so the action records `to: null, source: "registry"`.
  if (vulnerabilities.length === 0) {
    const seen = new Set();
    for (const dep of dependencies) {
      const name = nonEmpty(dep?.name);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      actions.push({
        package: name,
        strategy: dep?.depType === "transitive" ? "transitive-pin" : "direct-bump",
        from: nonEmpty(dep?.currentValue),
        to: null,
        tool: selectTool(tools, dep?.depType === "transitive" ? "transitive-pin" : "direct-bump", group, nonEmpty(dep?.manifestPath)),
        manifest: nonEmpty(dep?.manifestPath),
        severity: null,
        cveId: null,
        ghsaId: null,
        scope: dep?.depType ?? null,
        source: "registry",
      });
    }
  }

  // Deterministic order: severity (critical→low), then package name.
  actions.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || String(a.package).localeCompare(String(b.package)));
  vulnerabilities.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || String(a.package ?? "").localeCompare(String(b.package ?? "")));

  return {
    repo: url,
    url,
    dir,
    ecosystem: group,
    cloneError: cloneError ?? null,
    vulnerabilities,
    actions,
    notes,
    tools: availableTools,
    skill,
    generatedBy: "deterministic",
  };
}
