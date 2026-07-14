/**
 * Datasource field resolution (record 0065) — the ONE place that decides what a
 * dataset row MEANS when the input omits `dependency_scope` / `manifest_path`.
 *
 * Governing principle:
 *
 *     Provided wins.  Absent derives.  Underivable blocks — it never guesses.
 *
 * Both fields are optional in the input. Before 0065 their absence silently
 * defaulted to the WRONG value: `strategyFor` collapsed a null scope into
 * `direct-bump`, whose lane then demanded the package be declared in a manifest
 * — which a transitive dependency, by definition, is not. Six of twelve findings
 * skipped, and contract C1 reported the pipeline's own missing inference as a
 * DATASET violation.
 *
 * The load-bearing insight: "declared in no manifest" is not a failure, it is the
 * DEFINITION of a transitive dependency. This module turns that into a fact.
 *
 * Pure — no fs, no network, no subprocess. Callers supply the evidence:
 *   - `commands.resolveDatasource` (the stage) reads it from the clone on disk;
 *   - `buildRemediationPlan` reuses it against the fingerprint's `dependencies`,
 *     so a plan built WITHOUT the stage (unit tests, other flows) is still right.
 * One implementation, two callers — they cannot drift.
 */

/** Scope a row may carry. `null` = not yet resolved. */
export const SCOPES = Object.freeze(["direct", "transitive"]);

/** Provenance of a resolved `scope`. */
export const SCOPE_SOURCES = Object.freeze(["dataset", "discovered", "inferred", "unresolved", "mock"]);

/** Provenance of a resolved `manifestPath`. `none` = resolved-transitive: no manifest is NEEDED. */
export const MANIFEST_SOURCES = Object.freeze(["dataset", "discovered", "none", "mock"]);

const nonEmpty = (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

/** Normalize a supplied scope token; anything outside the vocabulary is `null` (= unsupplied). */
export function normalizeScope(token) {
  const key = nonEmpty(token)?.toLowerCase() ?? null;
  return SCOPES.includes(key) ? key : null;
}

/**
 * Every distinct manifest that DECLARES `pkg`, in first-seen order.
 *
 * A package declared in several manifests is a genuine multi-module case
 * (`repo-a/` and `repo-b/` both pinning lodash). The dependabot CSV can only name
 * ONE `manifest_path` per finding, so it silently under-remediates such a repo;
 * discovery finds them all.
 */
export function declaringManifests(pkg, dependencies) {
  const name = nonEmpty(pkg);
  if (name === null || !Array.isArray(dependencies)) return [];
  const out = [];
  for (const dep of dependencies) {
    if (dep?.name !== name) continue;
    const manifest = nonEmpty(dep?.manifestPath);
    if (manifest !== null && !out.includes(manifest)) out.push(manifest);
  }
  return out;
}

/**
 * Resolve one row's two fields against the evidence.
 *
 * @param {object}   input
 * @param {string?}  input.pkg           the row's package
 * @param {string?}  input.suppliedScope    `dependency_scope` from the input, if any
 * @param {string?}  input.suppliedManifest `manifest_path` from the input, if any
 * @param {object[]} input.dependencies  manifest-declared deps for this repo ({name, manifestPath})
 * @param {boolean}  input.resolvable    could we read this repo's manifests at all?
 *                                       (clone succeeded AND at least one known manifest was found).
 *                                       FALSE means absence-of-declaration proves nothing.
 *
 * @returns {{scope, scopeSource, manifests: string[], manifestSource, reason: string|null}}
 *   `manifests` is EMPTY for a resolved-transitive row — that is a RESOLVED state,
 *   not a missing one: the pin writer owns its own target file (`getPinWriter`
 *   resolves npm `overrides` → package.json, maven `dependencyManagement` → pom.xml,
 *   pip → constraints.txt), so it never needed a `manifest_path`.
 */
export function resolveRow({ pkg, suppliedScope, suppliedManifest, dependencies, resolvable }) {
  const supplied = normalizeScope(suppliedScope);
  const manifest = nonEmpty(suppliedManifest);
  const declaring = declaringManifests(pkg, dependencies);

  // ── manifest_path ────────────────────────────────────────────────────────
  // Provided wins — and is NEVER second-guessed, even when no dep record backs
  // it. A dataset that names a manifest not declaring the package is CONTRADICTING
  // reality; that contradiction must survive to C1 as a real violation, not be
  // quietly repaired here.
  const manifests = manifest !== null ? [manifest] : declaring;
  const manifestSource = manifest !== null ? "dataset" : declaring.length > 0 ? "discovered" : "none";

  // ── dependency_scope ─────────────────────────────────────────────────────
  if (supplied !== null) {
    return { scope: supplied, scopeSource: "dataset", manifests, manifestSource, reason: null };
  }
  if (resolvable !== true) {
    // We could not read this repo's manifests, so "not declared" proves NOTHING.
    // Refuse to infer. Downstream this BLOCKS the row — it is never direct-bumped.
    return {
      scope: null,
      scopeSource: "unresolved",
      manifests,
      manifestSource,
      reason: "scope unresolved: no readable manifest in this repo",
    };
  }
  if (declaring.length > 0) {
    return { scope: "direct", scopeSource: "discovered", manifests, manifestSource, reason: null };
  }
  // Declared in no manifest we can read, and we CAN read them → transitive.
  return {
    scope: "transitive",
    scopeSource: "inferred",
    manifests,
    manifestSource,
    reason: "declared in no manifest → transitive",
  };
}
