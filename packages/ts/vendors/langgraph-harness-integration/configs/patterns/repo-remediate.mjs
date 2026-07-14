/**
 * commands.repoRemediate — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the pipeline's first
 * MUTATING stage (renovate-harness-enhancements Epic 03; records 0019/A3+D2,
 * rewritten by 0032/A2–A6).
 *
 * 0032 REWRITE — the plan is the authority, the atom is the executor:
 *
 * · CANDIDACY (0032/A3, superseding 0023/A1's fingerprint gate): when
 *   `plans_from` carries a plan for the repo, its `actions[]` ARE the
 *   candidates — the advisory named them, the plan completed them
 *   (`package/from/to/strategy/tool/manifest`). The fingerprint's extracted
 *   deps ENRICH/CONFIRM the on-disk token for the direct lane; they no longer
 *   ADMIT candidates. Run `a52fbfa5` skipped 9 of 12 records as "package not
 *   in extracted dependencies" when every one was fully named by the dataset —
 *   that gate is gone. Without a plan the legacy dataset/fingerprint lane
 *   still runs (unit tests, hand-built states).
 *
 * · STRATEGY DISPATCH (0032/A2): `plans_from` stops being metadata-only.
 *   `direct-bump` → locate + rewrite the declared version token;
 *   `transitive-pin` → the ecosystem's PIN WRITER (npm `overrides` /
 *   pip constraints / maven `<dependencyManagement>`; registry
 *   `PIN_WRITERS`, 0032/D2) — which needs no pre-existing dep record at all.
 *   0034/A2+D1: for the pip transitive-pin lane, `constraints.txt` alone is
 *   INERT when a stale direct `==` pin in requirements.txt (a frozen `pip
 *   freeze` closure line) shadows it — `confirmPipTransitivePin` de-shadows
 *   that line and CONFIRMS the patched floor, bounded to `MAX_CONFIRM_ATTEMPTS`
 *   (rule 4); an unconfirmable pin records `applied` + `confirmed:false` (never
 *   a silent `fixed`), which validate reads as `broken`.
 *
 * · TARGET LADDER (0032/A4, HITL ruling H2 — superseding 0023's straight-to-
 *   latest ordering; the repo-source lane's registry principle is retained):
 *     ① dataset `recommended_version` (applied at a minimum — contract C1)
 *     ② advisory `first_patched_version`
 *     ③ next eligible stable > from (minimal bump)     ← repo-source enters here
 *     ④ registry latest stable — LAST RESORT
 *     ⑤ skip — only when every rung fails; always recorded + logged
 *   0033/A2: rung ③ optionally INSTALL-VERIFIES its pick — the opt-in
 *   `resolve_strategy: "install-verified"` delegates to the version-discovery
 *   engine's `find()` (first ranked candidate that actually installs, tested
 *   versions decision-logged); the default `"advertised"` keeps the pre-0033
 *   selection byte-for-byte.
 *
 * · RANGE-AWARE EDITS (0032/A5): a caret/tilde/floor `from` is REWRITTEN via
 *   `getNewValue` (`^4.18.0` → `^4.19.2`), not rejected; only constraints
 *   outside the supported grammar still skip `unsupported version syntax`.
 *
 * · TRUTHFUL SKIP LABELS (0032/A6): the omnibus "package not in extracted
 *   dependencies" label is split into its real causes — `transitive — needs
 *   pin writer`, `ecosystem unsupported by extractor`, `package not found in
 *   manifest <path>`, `manifest missing: <path>`.
 *
 * · DECISION LOG (0032/D1): every gate verdict, ladder rung, writer dispatch,
 *   and outcome appends one JSONL line to the session's `decision.jsonl`
 *   (optional `decision_log` param — absent → no logging, exactly as before).
 *
 * · POLICY (Epic 04 / 0019 D3; relocated by 0032/A7): when an action arrives
 *   pre-stamped by `commands.applyPackageRules` (`action.policy`), that
 *   verdict is consumed; otherwise the declarative rule list at `policy_path`
 *   is evaluated inline as before. Posture: 0032/A1 — the shipped default
 *   policy closes nothing; skipping is the last option.
 *
 * Mock seam unchanged (offline acceptance contract): under `ctx.options.mock`
 * the atom pushes the deterministic stub record — zero HTTP, zero repo
 * writes. A REAL run never fabricates: clone-failed/missing-dir repos record
 * UNAVAILABLE skips (0019/A3 — every skip is recorded, never dropped).
 */

import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { writeFileAtomic } from "../../src/sdk.mjs";
import { normalizeRepoUrl } from "../../src/repo-url.mjs";
import { isVersion, isStable, isGreaterThan, sortVersions, getNewValue, isRewritableConstraint } from "../../src/versioning-npm.mjs";
import { isDottedVersion, isGreaterDotted, compareDotted } from "../../src/versioning-ext.mjs";
import { bumpPipRequirement, normalizePipName } from "../../src/manifest-edit-ext.mjs";
import { getReleases } from "../../src/registry-lookup.mjs";
import { find as findNextInstallable } from "../../src/version-discovery.mjs";
import { getEcosystem, getPinWriter } from "../../src/ecosystem-registry.mjs";
import {
  extractNpmDependencies,
  extractGoModDependencies,
  extractMavenDependencies,
  extractPipRequirements,
  extractPyprojectDependencies,
} from "../../src/manifest-deps.mjs";
import { createDecisionLogger } from "../../src/decision-log.mjs";
import { loadPolicy, applyPolicyRules } from "../policy/apply-policy.mjs";
import { MATCHERS } from "../policy/matchers/index.mjs";

export const meta = {
  name: "commands.repoRemediate",
  category: "commands",
  summary: "Execute the remediation plan: strategy-dispatched direct bumps + transitive pins, advisory-first target ladder, decision-logged — mock-first, records applied/skipped remediations.",
  params: {
    type: "object",
    required: ["fingerprints_from", "dataset_from", "into"],
    properties: {
      fingerprints_from: { type: "string", minLength: 1 },
      dataset_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      // declarative remediation policy (Epic 04) — resolved against the flow dir
      policy_path: { type: "string" },
      // 0032/A2: the deterministic per-repo plan this stage EXECUTES — candidacy,
      // strategy, and targets come from it (0032/A3/A4). When absent the atom
      // falls back to the legacy dataset/fingerprint lane.
      plans_from: { type: "string" },
      // 0032/D1: session decision log (JSONL). Absent → no decision logging.
      decision_log: { type: "string" },
      // 0033/A2: how ladder rung ③ resolves its "next-eligible" pick.
      // "advertised" (default) = today's behavior byte-for-byte — the first
      // advertised stable release past `from`. "install-verified" delegates
      // rung ③ to the version-discovery engine's find(): install-test the
      // ranked candidates (minimal bump first) and take the first that
      // actually installs. Opt-in — the finders stand alone without it.
      resolve_strategy: { enum: ["advertised", "install-verified"] },
    },
  },
  returns: "node",
};

const exists = (path) => access(path).then(() => true, () => false);

/** 0034/D1: bound the post-apply version-confirmation retry (platform rule 4). */
const MAX_CONFIRM_ATTEMPTS = 5;

// datasource (on extracted dependency records) → registry ecosystem id
const DATASOURCE_TO_ECOSYSTEM = { npm: "node", go: "go", pypi: "python", maven: "java-maven" };
// dataset `ecosystem` column token (dependabot CSV) → registry ecosystem id
const DATASET_TOKEN_TO_ECOSYSTEM = {
  npm: "node",
  yarn: "node",
  pnpm: "node",
  pip: "python",
  poetry: "python",
  uv: "python",
  maven: "java-maven",
  gradle: "java-gradle",
  go: "go",
  gomod: "go",
};
// fresh-manifest-read dispatch for the plan's `manifest` path (0032/A3 — how a
// sub-module manifest like repo-a/package.json resolves without recursion)
const READER_BY_BASENAME = {
  "package.json": extractNpmDependencies,
  "go.mod": extractGoModDependencies,
  "pom.xml": extractMavenDependencies,
  "requirements.txt": extractPipRequirements,
  "pyproject.toml": extractPyprojectDependencies,
};

/** Deterministic stub record — mirrors stubDependencies' harness-mock-pkg. */
function stubRemediation(url, dir, skipReason) {
  return {
    repo: url ?? null,
    dir: dir ?? null,
    package: "harness-mock-pkg",
    from: "1.0.0",
    to: "99.0.0",
    source: null,
    releaseTimestamp: null,
    applied: false,
    skipReason,
  };
}

/**
 * Does the ingested dataset carry a `package` column at all? (0023/A1 — the
 * spreadsheet-vs-repo-source shape question; unchanged by 0032.)
 */
function hasPackageColumn(dataset, rows) {
  const headers = Array.isArray(dataset.original_headers) && dataset.original_headers.length > 0
    ? dataset.original_headers
    : Array.isArray(dataset.selected_headers)
      ? dataset.selected_headers
      : [];
  if (headers.length > 0) return headers.includes("package");
  return rows.some((row) => row != null && Object.hasOwn(row, "package"));
}

/** First occurrence of each dependency name — a repo's candidate set, deduped. */
function uniqueByName(dependencies) {
  const seen = new Set();
  const out = [];
  for (const dep of dependencies) {
    const name = typeof dep?.name === "string" && dep.name.length > 0 ? dep.name : null;
    if (name === null || seen.has(name)) continue;
    seen.add(name);
    out.push(dep);
  }
  return out;
}

function record(url, dir, pkg, fields) {
  return {
    repo: url ?? null,
    dir: dir ?? null,
    package: pkg ?? null,
    from: null,
    to: null,
    source: null,
    releaseTimestamp: null,
    applied: false,
    skipReason: null,
    ...fields,
  };
}

/** Per-ecosystem version comparators: strict semver for node, dotted otherwise. */
function comparatorsFor(ecoId) {
  if (ecoId === "node" || ecoId === null) return { isV: isVersion, isGreater: isGreaterThan };
  return { isV: isDottedVersion, isGreater: isGreaterDotted };
}

// 0033/A2: the version-discovery package manager rung ③ install-tests through,
// per registry ecosystem id. The ladder's registry rungs only run for node (or
// mock — see below), so npm is the effective default; the other entries keep
// the mapping honest if the registry rungs ever widen.
const LADDER_PACKAGE_MANAGER = { node: "npm", python: "pip", "java-maven": "maven", "java-gradle": "maven", rust: "cargo" };

/**
 * The target-resolution ladder (0032/A4). Walks rungs ①–④ and returns the
 * first eligible target `{ to, rung, source, releaseTimestamp }`, or null
 * (rung ⑤ — the caller records the skip). `from` may be a range; then
 * greater-than checks are skipped and rewritability decides downstream.
 *
 * 0033/A2: under `resolveStrategy: "install-verified"` rung ③ delegates to the
 * version-discovery engine's `find()` over the SAME ranked candidates (minimal
 * bump first) — the pick is the first candidate that actually installs, and
 * the decision line records every tested version. Default `"advertised"` keeps
 * the pre-0033 selection byte-for-byte.
 */
async function resolveTargetLadder({ pkg, from, ecoId, recommended, firstPatched, lookup, ctx, log, resolveStrategy = "advertised", installFind = findNextInstallable }) {
  const { isV, isGreater } = comparatorsFor(ecoId);
  const fromExact = isV(from);
  const eligible = (candidate) => isV(candidate) && (!fromExact || isGreater(candidate, from));
  const rungs = [
    { rung: 1, source: "dataset", candidate: recommended },
    { rung: 2, source: "advisory", candidate: firstPatched },
  ];
  for (const { rung, source, candidate } of rungs) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    if (eligible(candidate)) {
      await log({ decision: "target-resolution", package: pkg, rung, source, from: from ?? null, to: candidate, outcome: "selected" });
      return { to: candidate, rung, source, releaseTimestamp: null };
    }
    await log({ decision: "target-resolution", package: pkg, rung, source, from: from ?? null, to: candidate, outcome: "ineligible" });
  }
  // Rungs ③/④ — registry. Only meaningful for the npm registry lookup this
  // pack ships (and the mock lookup); other ecosystems fall through to ⑤.
  if (ecoId === "node" || ctx.options.mock) {
    const found = await lookup({ packageName: pkg }, ctx).catch(() => null);
    const candidates = (found?.releases ?? [])
      .filter((r) => isStable(r.version) && !r.isDeprecated && (!fromExact || isGreaterThan(r.version, from)))
      .sort((a, b) => sortVersions(a.version, b.version));
    if (candidates.length > 0) {
      // ③ next eligible (minimal bump). ④ latest is the structural last resort —
      // reachable when ③'s pick is later filtered (e.g. cooldown, a future rule).
      // Record `source` keeps the established "registry" value; `rung`
      // distinguishes next-eligible (3) from latest (4).
      if (resolveStrategy === "install-verified") {
        // 0033/A2: install-test the ranked candidates IN LADDER ORDER (minimal
        // bump first) and take the first that installs. A finder error degrades
        // to "nothing verified" — recorded below, never a throw.
        const pm = LADDER_PACKAGE_MANAGER[ecoId] ?? "npm";
        const probe = await installFind(pm, pkg, { candidates, order: "asc" }, ctx).catch(() => null);
        const tested = (probe?.tested ?? []).map((t) => ({ version: t.version, ok: t.ok === true }));
        if (probe?.found === true) {
          await log({ decision: "target-resolution", package: pkg, rung: 3, source: "registry", detail: "next-eligible (install-verified)", from: from ?? null, to: probe.version, tested, outcome: "selected" });
          return { to: probe.version, rung: 3, source: "registry", releaseTimestamp: probe.releaseTimestamp ?? null };
        }
        await log({ decision: "target-resolution", package: pkg, rung: 3, source: "registry", detail: "next-eligible (install-verified)", from: from ?? null, to: null, tested, outcome: "no-installable-candidate" });
        return null;
      }
      const next = candidates[0];
      await log({ decision: "target-resolution", package: pkg, rung: 3, source: "registry", detail: "next-eligible", from: from ?? null, to: next.version, outcome: "selected" });
      return { to: next.version, rung: 3, source: "registry", releaseTimestamp: next.releaseTimestamp ?? null };
    }
    await log({ decision: "target-resolution", package: pkg, rung: 4, source: "registry", detail: "latest", from: from ?? null, to: null, outcome: "no-candidates" });
  } else {
    await log({ decision: "target-resolution", package: pkg, rung: 3, source: "registry", from: from ?? null, to: null, outcome: `registry rungs unavailable for ${ecoId ?? "unknown"}` });
  }
  return null;
}

/**
 * 0034/A2 + D1 — de-shadow a stale DIRECT pip pin and confirm the patched
 * floor, bounded (platform rule 4). A `transitive-pin` writes `constraints.txt`,
 * but pip only honors a constraint when the requirement it constrains is not
 * itself pinned lower: a frozen `pip freeze` closure line (`Jinja2==3.1.2`) in
 * requirements.txt SHADOWS the `jinja2==3.1.4` constraint (pip resolves — or
 * hard-conflicts on — the direct line). Each attempt reads requirements.txt,
 * and if an EXACT (`==`) direct pin of `pkg` sits BELOW `floor`, promotes it to
 * `floor` (a direct bump) and retries; it converges once no stale pin remains
 * (or the requirements.txt is absent — then the constraint is authoritative),
 * or the cap is hit. Only touches requirements.txt; no network. Returns
 * `{ confirmed, observed, deShadowed, attempts }`.
 * @param {{dir: string, pkg: string, floor: string}} input
 */
export async function confirmPipTransitivePin({ dir, pkg, floor }) {
  const reqPath = join(dir, "requirements.txt");
  let deShadowed = false;
  let observed = null;
  for (let attempt = 1; attempt <= MAX_CONFIRM_ATTEMPTS; attempt += 1) {
    const text = await readFile(reqPath, "utf8").catch(() => null);
    // No requirements.txt → nothing shadows constraints.txt; the pin is authoritative.
    if (text === null) return { confirmed: true, observed, deShadowed, attempts: attempt };
    const { deps } = extractPipRequirements(text, "requirements.txt");
    const direct = deps.find((d) => normalizePipName(d.name) === normalizePipName(pkg)) ?? null;
    // No direct pin, or a non-`==` constraint the floor already satisfies → the
    // constraint governs; nothing to de-shadow.
    if (direct === null || direct.operator !== "==") return { confirmed: true, observed, deShadowed, attempts: attempt };
    observed = direct.currentValue;
    if (isDottedVersion(observed) && isDottedVersion(floor) && compareDotted(observed, floor) >= 0) {
      return { confirmed: true, observed, deShadowed, attempts: attempt }; // pinned at/above the floor
    }
    // Stale exact pin below the floor → promote it (0034/A2), then re-confirm.
    const promoted = bumpPipRequirement(text, pkg, null, floor);
    if (promoted === null) return { confirmed: false, observed, deShadowed, attempts: attempt };
    await writeFileAtomic(reqPath, promoted);
    deShadowed = true;
    observed = floor;
  }
  return { confirmed: false, observed, deShadowed, attempts: MAX_CONFIRM_ATTEMPTS };
}

/**
 * Test seam: build the factory over an injected registry lookup and (0033/A2)
 * an injected install-verifying finder — the version-discovery engine's
 * `find()` by default, a stub in unit tests so no subprocess ever runs.
 */
export function _repoRemediateWith({ lookup = getReleases, installFind = findNextInstallable } = {}) {
  return function repoRemediateFactory(params, ctx) {
    // 0033/A2: opt-in rung-③ strategy; absent/anything-else → "advertised".
    const resolveStrategy = params.resolve_strategy === "install-verified" ? "install-verified" : "advertised";
    // Policy loads once per compiled node, on the FIRST invocation and
    // REGARDLESS of mock — a broken/missing policy file fails loudly in CI
    // too; silent policy-off is not a state (Epic 04, story 04/02/01).
    let policyRules = null;
    let logger = null;
    return async (state) => {
      const entries = Array.isArray(state[params.fingerprints_from]) ? state[params.fingerprints_from] : [];
      const dataset = state[params.dataset_from] ?? {};
      const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
      if (policyRules === null) {
        const policyRel = params.policy_path ?? "../policy/remediation-policy.yaml";
        policyRules = await loadPolicy(isAbsolute(policyRel) ? policyRel : resolve(ctx.options.baseDir, policyRel));
      }
      if (logger === null) {
        const logRel = params.decision_log ?? null;
        logger = createDecisionLogger({
          path: logRel === null ? null : isAbsolute(logRel) ? logRel : resolve(ctx.options.baseDir, logRel),
          mock: ctx.options.mock === true,
          stage: "remediate",
        });
      }
      const log = (fields) => logger.log(fields);
      const datasetHasPackage = hasPackageColumn(dataset, rows);
      // 0032/A2: the plan this stage EXECUTES — url → plan object.
      const plans = Array.isArray(state[params.plans_from]) ? state[params.plans_from] : [];
      const planByUrl = new Map();
      for (const plan of plans) {
        const key = normalizeRepoUrl(plan?.url ?? "");
        if (key !== null && !planByUrl.has(key)) planByUrl.set(key, plan);
      }
      const remediations = [];
      const total = entries.length;
      let index = 0;

      for (const entry of entries) {
        index += 1;
        ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });
        const url = entry?.url ?? null;
        const dir = entry?.dir ?? null;

        if (ctx.options.mock) {
          remediations.push(stubRemediation(url, dir, "mock run"));
          await log({ decision: "outcome", repo: url, package: "harness-mock-pkg", outcome: "skipped", skipReason: "mock run" });
          continue;
        }
        if (typeof entry?.cloneError === "string" && entry.cloneError.length > 0) {
          remediations.push(record(url, dir, null, { skipReason: `clone failed: ${entry.cloneError}` }));
          await log({ decision: "outcome", repo: url, package: null, outcome: "skipped", skipReason: `clone failed: ${entry.cloneError}` });
          continue;
        }
        if (typeof dir !== "string" || dir.length === 0 || !(await exists(dir))) {
          remediations.push(record(url, dir, null, { skipReason: "repo dir missing" }));
          await log({ decision: "outcome", repo: url, package: null, outcome: "skipped", skipReason: "repo dir missing" });
          continue;
        }

        const normalizedUrl = normalizeRepoUrl(url ?? "");
        const repoRows = rows.filter((row) => normalizeRepoUrl(String(row?.repo_url ?? "")) === normalizedUrl && normalizedUrl !== null);
        const dependencies = Array.isArray(entry.dependencies) ? entry.dependencies : [];
        const plan = normalizedUrl !== null ? planByUrl.get(normalizedUrl) ?? null : null;
        const planActions = Array.isArray(plan?.actions) ? plan.actions : [];

        // Shared per-candidate machinery, used by both lanes below.
        const dominant = entry.fingerprint?.dominantEcosystem ?? null;
        const dominantEntry = Array.isArray(entry.fingerprint?.ecosystems)
          ? entry.fingerprint.ecosystems.find((e) => e?.id === dominant)
          : null;
        const evaluatePolicy = (depType, pkg) =>
          applyPolicyRules(
            {
              repoUrl: normalizedUrl,
              dominantEcosystem: dominant,
              confidenceBucket: dominantEntry?.confidenceBucket ?? null,
              depType,
              package: pkg,
            },
            policyRules,
            MATCHERS,
          );

        /**
         * Locate the declared dependency record for a direct edit: fingerprint
         * deps first (0032/A3 — enrich/confirm), then a FRESH read of the
         * plan's manifest (how repo-a/package.json resolves). Returns
         * { dep } | { miss: <truthful cause> }.
         */
        const locateDep = async (pkg, manifest) => {
          const fromFp = dependencies.find((d) => d?.name === pkg && (!manifest || d?.manifestPath === manifest))
            ?? dependencies.find((d) => d?.name === pkg);
          if (fromFp && typeof fromFp.currentValue === "string") return { dep: fromFp };
          if (typeof manifest === "string" && manifest.length > 0) {
            const base = manifest.split("/").pop();
            const reader = READER_BY_BASENAME[base] ?? null;
            if (reader === null) return { miss: "ecosystem unsupported by extractor" };
            const text = await readFile(join(dir, manifest), "utf8").catch(() => null);
            if (text === null) return { miss: `manifest missing: ${manifest}` };
            const { deps } = reader(text, manifest);
            const dep = deps.find((d) => d?.name === pkg && typeof d?.currentValue === "string");
            if (dep) return { dep };
            return { miss: `package not found in manifest ${manifest}` };
          }
          return { miss: fromFp ? `package not found in manifest ${fromFp.manifestPath ?? "?"}` : "package not declared in any scanned manifest" };
        };

        /** Execute one plan action (0032/A2 dispatch, 0065/A2 three-way). Pushes exactly one record. */
        const executeAction = async (action) => {
          const pkg = action.package;
          const row = repoRows.find((r) => r?.package === pkg) ?? null;
          // 0065/A2 — THREE-way, and it must stay three-way. This used to read
          // `action.strategy === "transitive-pin" ? "transitive-pin" : "direct-bump"`,
          // which re-introduced 0065/A1's bug at a second site: an UNRESOLVED
          // strategy was silently coerced into `direct-bump`. Reverting this to a
          // two-branch ternary restores the original defect — the highest-value
          // regression in this record. `null` is BLOCKED, never guessed.
          const strategy = action.strategy === "transitive-pin"
            ? "transitive-pin"
            : action.strategy === "direct-bump"
              ? "direct-bump"
              : null;
          const provenance = {
            planned: true,
            strategy,
            tool: action.tool ?? null,
            scopeSource: action.scopeSource ?? null,
            manifestSource: action.manifestSource ?? null,
            // 0065/D2 — the record must NAME the manifest it targeted. After D1's
            // multi-module fan-out one (repo, package) pair can carry SEVERAL
            // records (repo-a/ and repo-b/; requirements.txt and pyproject.toml),
            // and contract C1 matches remediations by that pair. Without this
            // field C1's `find` returns whichever record came first and reports
            // BOTH rows satisfied — masking a genuinely failed edit behind a
            // sibling's success. That is exactly the always-green class of defect
            // 0055/0056 kept relearning.
            manifest: action.manifest ?? null,
          };
          await log({ decision: "candidacy", repo: url, package: pkg, source: "plan", strategy, manifest: action.manifest ?? null, scopeSource: action.scopeSource ?? null });

          // ── unresolved lane: scope could be neither read nor derived ──────
          // `commands.resolveDatasource` could not see this repo's manifests (clone
          // failed / no readable manifest), so "not declared" proves nothing. Refuse
          // to pick a lane — a guessed direct-bump here is exactly the 0065 bug.
          if (strategy === null) {
            const skipReason = action.unresolvedReason ?? "dependency scope unresolved — cannot select a remediation lane";
            remediations.push(record(url, dir, pkg, { from: action.from ?? null, skipReason, blocked: true, ...provenance }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "blocked", skipReason });
            return;
          }

          // ── direct lane: locate + confirm the on-disk token ──────────────
          // A miss here is now a REAL contradiction, not a missing inference: the
          // scope is resolved `direct`, so the dataset (or the discovery) said this
          // package IS declared — and it is not. C1 should catch that.
          let dep = null;
          if (strategy === "direct-bump") {
            const located = await locateDep(pkg, action.manifest ?? null);
            if (located.miss) {
              remediations.push(record(url, dir, pkg, { from: action.from ?? null, skipReason: located.miss, ...provenance }));
              await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: located.miss });
              return;
            }
            dep = located.dep;
          }

          // ── policy: pre-stamped by applyPackageRules (0032/A7) or inline ──
          const verdict = action.policy && typeof action.policy.allowed === "boolean"
            ? action.policy
            : evaluatePolicy(dep?.depType ?? null, pkg);
          await log({ decision: "policy", repo: url, package: pkg, allowed: verdict.allowed, skipReason: verdict.skipReason ?? null, stamped: Boolean(action.policy) });
          if (!verdict.allowed) {
            remediations.push(record(url, dir, pkg, { from: dep?.currentValue ?? action.from ?? null, skipReason: verdict.skipReason, ...provenance }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: verdict.skipReason });
            return;
          }

          // ── ecosystem resolution ──────────────────────────────────────────
          const ecoId = (dep && (DATASOURCE_TO_ECOSYSTEM[dep.datasource] ?? dep.datasource))
            ?? DATASET_TOKEN_TO_ECOSYSTEM[String(row?.ecosystem ?? "").toLowerCase().trim()]
            ?? dominant;
          const from = dep?.currentValue ?? action.from ?? null;

          // ── target ladder (0032/A4) ───────────────────────────────────────
          const recommended = row?.recommended_version?.trim?.() || (action.source !== "registry" ? action.to : null);
          const firstPatched = row?.first_patched_version?.trim?.() || null;
          // Contract C1 short-circuit: the advisory's recommended version is
          // already on disk → satisfied; never bump PAST it via the registry.
          if (recommended !== null && from === recommended) {
            remediations.push(record(url, dir, pkg, { from, to: recommended, source: "dataset", skipReason: "already at target", ...provenance }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: "already at target" });
            return;
          }
          const target = await resolveTargetLadder({ pkg, from, ecoId, recommended, firstPatched, lookup, ctx, log, resolveStrategy, installFind });
          if (target === null) {
            const skipReason = from !== null && (recommended === from || firstPatched === from) ? "already at target" : "no eligible target (ladder exhausted)";
            remediations.push(record(url, dir, pkg, { from, skipReason, ...provenance }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason });
            return;
          }
          const { to, rung, source, releaseTimestamp } = target;

          // ── write: strategy dispatch (0032/A2 + D2) ───────────────────────
          if (strategy === "transitive-pin") {
            const writer = getPinWriter(ecoId);
            if (!writer) {
              const skipReason = `transitive — needs pin writer (${ecoId ?? "unknown ecosystem"})`;
              remediations.push(record(url, dir, pkg, { from, to, source, skipReason, ...provenance }));
              await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason });
              return;
            }
            await log({ decision: "writer", repo: url, package: pkg, strategy, tool: writer.tool, file: writer.file });
            const filePath = join(dir, writer.file);
            const content = await readFile(filePath, "utf8").catch(() => null);
            if (content === null && !writer.createIfMissing) {
              const skipReason = `manifest missing: ${writer.file}`;
              remediations.push(record(url, dir, pkg, { from, to, source, skipReason, ...provenance }));
              await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason });
              return;
            }
            const edited = writer.write(content, pkg, to);
            if (edited === null) {
              const skipReason = "transitive pin not written (already pinned or unsafe)";
              remediations.push(record(url, dir, pkg, { from, to, source, skipReason, ...provenance }));
              await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason });
              return;
            }
            await writeFileAtomic(filePath, edited);
            // 0034/A2 + D1: a pip transitive pin is inert while a stale direct
            // `==` pin in requirements.txt shadows it. Resolve that (bounded) and
            // CONFIRM the floor — never declare a fix on an unconfirmed version.
            if (ecoId === "python") {
              const conf = await confirmPipTransitivePin({ dir, pkg, floor: to });
              if (conf.deShadowed) {
                await log({ decision: "writer", repo: url, package: pkg, strategy, tool: "pip-requirement-bump", file: "requirements.txt", detail: "de-shadow stale direct pin" });
              }
              await log({ decision: "confirm", repo: url, package: pkg, floor: to, confirmed: conf.confirmed, observed: conf.observed, attempts: conf.attempts });
              const confFields = { ...(conf.deShadowed ? { deShadowed: "requirements.txt" } : {}), ...(conf.observed ? { observed: conf.observed } : {}) };
              if (!conf.confirmed) {
                remediations.push(record(url, dir, pkg, { from, to, source, releaseTimestamp, applied: true, confirmed: false, required: to, ...confFields, ...provenance, rung, pinnedIn: writer.file }));
                await log({ decision: "outcome", repo: url, package: pkg, outcome: "unconfirmed", from, to, rung, tool: writer.tool });
                return;
              }
              remediations.push(record(url, dir, pkg, { from, to, source, releaseTimestamp, applied: true, confirmed: true, ...confFields, ...provenance, rung, pinnedIn: writer.file }));
              await log({ decision: "outcome", repo: url, package: pkg, outcome: "applied", from, to, rung, tool: writer.tool });
              return;
            }
            remediations.push(record(url, dir, pkg, { from, to, source, releaseTimestamp, applied: true, ...provenance, rung, pinnedIn: writer.file }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "applied", from, to, rung, tool: writer.tool });
            return;
          }

          // direct-bump lane
          const eco = getEcosystem(ecoId);
          if (!eco?.bump) {
            const skipReason = `no bump support for ${ecoId}`;
            remediations.push(record(url, dir, pkg, { from, skipReason, ...provenance }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason });
            return;
          }
          // 0032/A5: compute the rewritten token — exact stays exact, a
          // supported range keeps its operator; outside the grammar → skip.
          let newToken = to;
          if (ecoId === "node" && !isVersion(from)) {
            if (!isRewritableConstraint(from)) {
              remediations.push(record(url, dir, pkg, { from, skipReason: "unsupported version syntax", ...provenance }));
              await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: "unsupported version syntax" });
              return;
            }
            newToken = getNewValue({ currentValue: from, rangeStrategy: action.rangeStrategy ?? "auto", newVersion: to });
            if (newToken === null) {
              remediations.push(record(url, dir, pkg, { from, skipReason: "unsupported version syntax", ...provenance }));
              await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: "unsupported version syntax" });
              return;
            }
          }
          if (newToken === from) {
            remediations.push(record(url, dir, pkg, { from, to, source, releaseTimestamp, skipReason: "already at target", ...provenance }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: "already at target" });
            return;
          }
          const manifestPath = join(dir, dep.manifestPath ?? "package.json");
          await log({ decision: "writer", repo: url, package: pkg, strategy, tool: action.tool ?? `${ecoId}-version-bump`, file: dep.manifestPath ?? "package.json" });
          const content = await readFile(manifestPath, "utf8").catch(() => null);
          // 0065: the manifest is the 5th arg — one ecosystem can own several
          // manifest grammars (python: requirements.txt AND pyproject.toml), so the
          // writer must know WHICH file it is editing. Ecosystems with a single
          // grammar ignore it.
          const edited = content === null ? null : eco.bump(content, pkg, dep.depType, newToken, dep.manifestPath ?? null);
          if (edited === null) {
            remediations.push(record(url, dir, pkg, { from, to, source, releaseTimestamp, skipReason: "manifest edit failed", ...provenance }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: "manifest edit failed" });
            return;
          }
          await writeFileAtomic(manifestPath, edited);
          remediations.push(record(url, dir, pkg, { from, to: newToken === to ? to : newToken, source, releaseTimestamp, applied: true, ...provenance, rung }));
          await log({ decision: "outcome", repo: url, package: pkg, outcome: "applied", from, to: newToken, rung });
        };

        // ── PLAN LANE (0032/A3): the plan's actions ARE the candidates ──────
        if (params.plans_from && plan !== null && planActions.length > 0) {
          for (const action of planActions) {
            if (typeof action?.package !== "string" || action.package.length === 0) continue;
            await executeAction(action);
          }
          continue;
        }
        if (params.plans_from && plan !== null && planActions.length === 0 && !datasetHasPackage && repoRows.length > 0) {
          remediations.push(record(url, dir, null, { skipReason: "no dependencies extracted (repo-source ingest)" }));
          await log({ decision: "outcome", repo: url, package: null, outcome: "skipped", skipReason: "no dependencies extracted (repo-source ingest)" });
          continue;
        }

        // ── LEGACY LANE (no plan): dataset/fingerprint candidacy, 0023/A1 ───
        const candidates = !datasetHasPackage
          ? uniqueByName(dependencies).map((dep) => ({ package: dep.name, recommended: "" }))
          : repoRows.map((row) => ({
              package: typeof row?.package === "string" && row.package.length > 0 ? row.package : null,
              recommended: typeof row?.recommended_version === "string" ? row.recommended_version.trim() : "",
            }));
        if (!datasetHasPackage && repoRows.length > 0 && candidates.length === 0) {
          remediations.push(record(url, dir, null, { skipReason: "no dependencies extracted (repo-source ingest)" }));
        }
        const applicable = !datasetHasPackage && repoRows.length === 0 ? [] : candidates;

        for (const candidate of applicable) {
          const pkg = candidate.package;
          if (!pkg) {
            remediations.push(record(url, dir, null, { skipReason: "blank 'package' cell" }));
            continue;
          }
          const dep = dependencies.find((d) => d?.name === pkg);
          if (!dep) {
            remediations.push(record(url, dir, pkg, { skipReason: "package not in extracted dependencies" }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: "package not in extracted dependencies" });
            continue;
          }
          const verdict = evaluatePolicy(dep.depType, dep.name);
          if (!verdict.allowed) {
            remediations.push(record(url, dir, pkg, { from: dep.currentValue, skipReason: verdict.skipReason }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: verdict.skipReason });
            continue;
          }
          const ecoId = DATASOURCE_TO_ECOSYSTEM[dep.datasource] ?? dep.datasource;
          const eco = getEcosystem(ecoId);
          if (!eco?.bump) {
            remediations.push(record(url, dir, pkg, { from: dep.currentValue, skipReason: `no bump support for ${ecoId}` }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: `no bump support for ${ecoId}` });
            continue;
          }
          const from = dep.currentValue;
          if (ecoId === "node" ? !isRewritableConstraint(from) : !comparatorsFor(ecoId).isV(from)) {
            remediations.push(record(url, dir, pkg, { from, skipReason: "unsupported version syntax" }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: "unsupported version syntax" });
            continue;
          }
          const row = repoRows.find((r) => r?.package === pkg) ?? null;
          const target = await resolveTargetLadder({
            pkg,
            from,
            ecoId,
            recommended: candidate.recommended || null,
            firstPatched: row?.first_patched_version?.trim?.() || null,
            lookup,
            ctx,
            log,
            resolveStrategy,
            installFind,
          });
          if (target === null) {
            remediations.push(record(url, dir, pkg, { from, skipReason: "no newer version available" }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: "no newer version available" });
            continue;
          }
          const { to, rung, source, releaseTimestamp } = target;
          if (to === from) {
            remediations.push(record(url, dir, pkg, { from, to, source, releaseTimestamp, skipReason: "already at target" }));
            continue;
          }
          let newToken = to;
          if (ecoId === "node" && !isVersion(from)) {
            newToken = getNewValue({ currentValue: from, rangeStrategy: "auto", newVersion: to });
            if (newToken === null) {
              remediations.push(record(url, dir, pkg, { from, skipReason: "unsupported version syntax" }));
              continue;
            }
          }
          const manifestPath = join(dir, dep.manifestPath ?? "package.json");
          const content = await readFile(manifestPath, "utf8").catch(() => null);
          // 0065: the manifest is the 5th arg — one ecosystem can own several
          // manifest grammars (python: requirements.txt AND pyproject.toml), so the
          // writer must know WHICH file it is editing. Ecosystems with a single
          // grammar ignore it.
          const edited = content === null ? null : eco.bump(content, pkg, dep.depType, newToken, dep.manifestPath ?? null);
          if (edited === null) {
            remediations.push(record(url, dir, pkg, { from, to, source, releaseTimestamp, skipReason: "manifest edit failed" }));
            await log({ decision: "outcome", repo: url, package: pkg, outcome: "skipped", skipReason: "manifest edit failed" });
            continue;
          }
          await writeFileAtomic(manifestPath, edited);
          remediations.push(record(url, dir, pkg, { from, to: newToken, source, releaseTimestamp, applied: true, rung }));
          await log({ decision: "outcome", repo: url, package: pkg, outcome: "applied", from, to: newToken, rung });
        }
      }
      // Plan provenance for LEGACY-lane records (plan-lane records are already
      // stamped at execution time — 0032/A2). Purely additive metadata.
      if (params.plans_from) {
        for (const rem of remediations) {
          if (typeof rem.package !== "string" || rem.package.length === 0 || Object.hasOwn(rem, "planned")) continue;
          const action = planByUrl.get(normalizeRepoUrl(rem.repo ?? ""))?.actions?.find?.((a) => a?.package === rem.package);
          if (action) {
            rem.planned = true;
            rem.strategy = action.strategy ?? null;
            rem.tool = action.tool ?? null;
          } else {
            rem.planned = false;
          }
        }
      }
      return { [params.into]: remediations };
    };
  };
}

export const repoRemediate = _repoRemediateWith({});
