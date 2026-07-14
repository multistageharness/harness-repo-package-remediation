/**
 * commands.remediationValidate — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the outcome-validation
 * stage (langgraph-flow.md capability 6 — "validate what was fixed, broken,
 * bug, blocked, skipped"). It CROSS-REFERENCES the remediation records with the
 * install-verify, build, and test results and classifies every attempt into the
 * five-category ledger, per repo and per package.
 *
 * PURE + NON-GATING (the install-verify discipline, 0027/A1): this atom does NO
 * I/O — it only reads channels the earlier stages already produced — so it runs
 * identically under `--mock` and on real runs, and it NEVER throws. A failure is
 * a RECORDED classification, never a pipeline abort.
 *
 * CLASSIFICATION (documented, defensible rules):
 *   · fixed   — a remediation was APPLIED, no downstream stage (install-verify
 *               / build / test) that ran for the repo failed, AND — when the
 *               install surfaced the resolved version (0034/D1) — that version
 *               SATISFIES the patched floor. A clean install that resolved a
 *               stale version is NOT a fix (see broken).
 *   · broken  — a remediation was APPLIED and a downstream stage failed for a
 *               reason ATTRIBUTABLE to the edit (a dependency/version conflict),
 *               or for an unexplained reason (conservative default); OR the
 *               install succeeded but the RESOLVED version is below the patched
 *               floor — a version-blind pass (0034/D1: `Jinja2-3.1.2` installed
 *               against a 3.1.4 floor when the constraint was shadowed by a
 *               stale direct pin). A genuine remediation regression.
 *   · blocked — a remediation was SKIPPED for an external reason (clone failed,
 *               repo dir missing, no bump support, a policy denial), OR was
 *               APPLIED but the only downstream failure has a BENIGN cause NOT
 *               attributable to the edit — an environmental block (a down
 *               package registry) or a pre-existing / toolchain break. This is
 *               the remediation002 diagnosis (capability 9): a registry-down
 *               `ECONNREFUSED` or a `tsc` TS5107 deprecation is never a verdict
 *               on whether the dependency edit was correct, so it must not read
 *               as `broken` and blame the remediation for a Docker outage.
 *   · skipped — a remediation was SKIPPED for a benign / no-op reason (already at
 *               target, no newer version, blank cell, unsupported syntax, mock).
 *   · bug     — an unexpected failure: a `manifest edit failed` skip, OR a
 *               downstream stage FAILED for a repo with NO applied remediation
 *               (a pre-existing failure the run surfaced, not one it caused).
 *
 * DOWNSTREAM DISPOSITION (0033, extended by 0035/A3): the applied-edit verdict
 * follows the CAUSAL chain install → build → test. The FIRST failed stage
 * decides: its `cause` (tagged upstream by install-verify / build-run AND, since
 * 0035/D1, by test-run via `src/diagnose-lib.mjs`) being benign (environment /
 * toolchain / lockfile-drift / pre-existing / missing-tool / no-tests) →
 * `blocked`; attributable (dependency-conflict) or absent → `broken`. Later
 * stage failures are causal CONSEQUENCES of the first (you cannot build without
 * a populated tree), so they never independently re-condemn the edit.
 *
 * 0035/A3: a TEST-stage failure is now diagnosed identically to install/build —
 * a missing test runner (`missing-tool`) or a test-less suite (`no-tests`) is an
 * environmental non-verdict on the edit → `blocked`, never `broken`. A pytest
 * exit-5 no-op never reaches here at all: test-run gates it to a `skipped` stage
 * up front (0035/A1), so `stageFailed` is false and the edit stays `fixed`.
 */

import { isAbsolute, resolve } from "node:path";

import { normalizeRepoUrl } from "../../src/repo-url.mjs";
import { compareDotted, isDottedVersion } from "../../src/versioning-ext.mjs";
import { normalizePipName } from "../../src/manifest-edit-ext.mjs";
import { createDecisionLogger } from "../../src/decision-log.mjs";
import { isAttributableCause, isBenignCause, describeCause } from "../../src/diagnose-lib.mjs";

export const meta = {
  name: "commands.remediationValidate",
  category: "commands",
  summary:
    "Classify every remediation attempt into fixed / broken / blocked / skipped / bug by cross-referencing install-verify, build, and test results — plus the C1 datasource-recommended contract gate (0032/D7). Non-gating, never throws.",
  params: {
    type: "object",
    required: ["remediations_from", "into"],
    properties: {
      remediations_from: { type: "string", minLength: 1 },
      install_verifications_from: { type: "string" },
      builds_from: { type: "string" },
      tests_from: { type: "string" },
      plans_from: { type: "string" },
      // 0032/D7: contract C1 — a dataset row carrying `recommended_version` is a
      // MINIMUM-APPLY obligation; violations are explicit findings, never silent.
      dataset_from: { type: "string" },
      // 0032/D1: session decision log (JSONL). Absent → no logging.
      decision_log: { type: "string" },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

const BENIGN_SKIP = [
  "already at target",
  "no newer version",
  "blank 'package' cell",
  "package not in extracted dependencies",
  "unsupported version syntax",
  "no dependencies extracted",
  "mock run",
  // 0032/A4 rung-⑤: the ladder was exhausted — a recorded last resort, not a block.
  "no eligible target (ladder exhausted)",
];

/** Map a skipReason string to blocked | skipped | bug (documented rules above). */
export function classifySkipReason(reason) {
  const r = typeof reason === "string" ? reason.toLowerCase() : "";
  if (r.length === 0) return "skipped";
  if (r.includes("manifest edit failed")) return "bug";
  if (
    r.includes("clone failed") ||
    r.includes("repo dir missing") ||
    r.includes("no bump support") ||
    // 0032/A6 truthful labels — capability gaps are BLOCKS, not benign no-ops.
    r.includes("needs pin writer") ||
    r.includes("ecosystem unsupported by extractor") ||
    r.includes("manifest missing") ||
    r.includes("package not found in manifest") ||
    r.includes("not declared in any scanned manifest") ||
    r.includes("transitive pin not written")
  ) {
    return "blocked";
  }
  if (BENIGN_SKIP.some((phrase) => r.includes(phrase))) return "skipped";
  // Anything else — most notably a declarative POLICY denial — is a block.
  return "blocked";
}

/** Strip a leading range operator (`^ ~ >= =` or `v`) off a constraint token. */
const bareVersion = (value) => String(value ?? "").trim().replace(/^(\^|~|>=|=|v)\s*/, "");

/**
 * D1 (0034): post-install version confirmation. Given an applied remediation's
 * patched floor (`to`) and the `installedVersions` map install-verify parsed
 * from the install logs, decide whether the RESOLVED version satisfies the
 * floor. Returns `{ confirmed, observed, required }`, or null when no installed
 * version is observable for the package (non-pip lanes, or a failed install) —
 * the caller then falls back to the downstream-based classification and never
 * regresses. This is the version-blind verify that let `Jinja2-3.1.2` pass as
 * "fixed" against a 3.1.4 floor when the constraint was shadowed (0034/A2).
 * Pure; exported for tests.
 */
export function confirmInstalledVersion(rem, installedVersions) {
  if (!installedVersions || typeof installedVersions !== "object") return null;
  const pkg = typeof rem?.package === "string" && rem.package.length > 0 ? rem.package : null;
  if (pkg === null) return null;
  const observed = installedVersions[normalizePipName(pkg)] ?? installedVersions[pkg] ?? null;
  if (observed === null) return null;
  const required = bareVersion(rem?.to);
  if (!isDottedVersion(observed) || !isDottedVersion(required)) return null;
  return { confirmed: compareDotted(observed, required) >= 0, observed, required };
}

/**
 * Contract C1 (0032/D7, HITL ruling 2026-07-09): if the datasource provides a
 * `recommended_version`, the pipeline must end with that package at ≥ that
 * version — or a recorded rung-⑤ last-resort skip. Pure; exported for tests.
 * @returns {{checked: number, satisfied: number, violations: object[]}}
 */
export function checkDatasourceContract(rows, remediations) {
  const result = { checked: 0, satisfied: 0, violations: [] };
  for (const row of Array.isArray(rows) ? rows : []) {
    const pkg = typeof row?.package === "string" && row.package.length > 0 ? row.package : null;
    const recommended = typeof row?.recommended_version === "string" && row.recommended_version.trim().length > 0 ? row.recommended_version.trim() : null;
    if (pkg === null || recommended === null) continue;
    result.checked += 1;
    const norm = normalizeRepoUrl(String(row?.repo_url ?? ""));
    // 0065/D2 — match PER MANIFEST, not just per (repo, package). D1s multi-module
    // fan-out means one pair can carry several remediation records (repo-a/ and
    // repo-b/; requirements.txt and pyproject.toml). A bare `find` returns the
    // first and would report EVERY row for that pair satisfied the moment ONE
    // sibling edit landed — masking a failed edit behind its siblings success.
    // A row that names its manifest is answered by the record for THAT manifest.
    const rowManifest = typeof row?.manifest_path === "string" && row.manifest_path.trim().length > 0
      ? row.manifest_path.trim()
      : null;
    const forPair = remediations.filter((r) => r?.package === pkg && normalizeRepoUrl(String(r?.repo ?? "")) === norm);
    const rem = (rowManifest === null
      ? forPair[0]
      : forPair.find((r) => (r?.manifest ?? null) === rowManifest) ?? forPair.find((r) => (r?.manifest ?? null) === null))
      ?? null;
    const to = bareVersion(rem?.to);
    const met =
      rem !== null &&
      ((rem.applied === true && isDottedVersion(to) && compareDotted(to, recommended) >= 0) ||
        rem.skipReason === "already at target" ||
        rem.skipReason === "mock run" ||
        rem.skipReason === "no eligible target (ladder exhausted)"); // logged last resort
    if (met) {
      result.satisfied += 1;
    } else {
      result.violations.push({
        contract: "C1",
        repo: row?.repo_url ?? null,
        package: pkg,
        recommended,
        applied: rem?.applied === true,
        to: rem?.to ?? null,
        reason: rem === null ? "no remediation record for datasource row" : rem.skipReason ?? `applied ${rem.to} < recommended ${recommended}`,
      });
    }
  }
  return result;
}

const stageFailed = (rec) => rec != null && (rec.failed === true || rec.status === "failed");
const stageStatus = (rec) => (rec == null ? "absent" : rec.status ?? (rec.failed ? "failed" : "ok"));
const stageCause = (rec) => (rec != null && typeof rec.cause === "string" ? rec.cause : null);

/** A stage produced EVIDENCE only if it actually executed — `skipped`/`absent` did not. */
const stageRan = (rec) => {
  const s = stageStatus(rec);
  return s === "ok" || s === "failed";
};
/** Why a non-running stage did not run: the diagnosed cause, else the raw skip tag. */
const stageSkipReason = (rec) =>
  rec == null ? null : (typeof rec.cause === "string" && rec.cause) || (typeof rec.skipped === "string" && rec.skipped) || null;

/**
 * 0051/A3 — the EVIDENCE gate behind `fixed`.
 *
 * `diagnoseDownstream` only sees stages that FAILED; stages that never RAN leave
 * it `failed:false`, which used to drop an applied edit straight into `fixed`. A
 * run whose install/build/test all skipped therefore scored a full green ledger on
 * ZERO execution evidence (the 12/12-fixed / all-stages-skipped report that
 * prompted this record). `fixed` is the strongest claim the pipeline makes; it now
 * requires that at least one downstream stage actually executed.
 *
 * The `absent` vs `skipped` split is load-bearing, not incidental:
 *   · ALL THREE records absent (null) → the stages were never wired into this
 *     classification at all (how the unit tests and any stage-less caller invoke
 *     `classifyRepo`). Not evidence of a starved pipeline — behavior is unchanged.
 *   · Records PRESENT but every one `skipped` → the atoms ran and declined this
 *     repo. That is the starvation this record repairs: unverified, so NOT `fixed`.
 *
 * Benign whitelists (0033/0035 — `missing-tool`, `no-tests`, …) are untouched:
 * they govern stages that ran-and-failed, or a partial skip where another stage
 * still produced evidence. Both keep `evidence: true` here.
 * Pure; exported for tests.
 * @returns {{evaluated: boolean, evidence: boolean, cause: string|null}}
 */
export function verificationEvidence({ installVerify = null, build = null, test = null } = {}) {
  const recs = [installVerify, build, test];
  if (recs.every((r) => r == null)) return { evaluated: false, evidence: true, cause: null };
  if (recs.some(stageRan)) return { evaluated: true, evidence: true, cause: null };
  const cause = recs.map(stageSkipReason).find((c) => typeof c === "string" && c.length > 0) ?? "not run";
  return { evaluated: true, evidence: false, cause };
}

/**
 * Diagnose the downstream health of one repo along the causal chain
 * install-verify → build → test (0033). The FIRST failed stage decides the
 * disposition of every APPLIED edit; later failures are consequences of it.
 * Pure.
 * @returns {{failed: boolean, disposition: "blocked"|"regression"|null,
 *   stage: string|null, cause: string|null}}
 */
export function diagnoseDownstream({ installVerify = null, build = null, test = null } = {}) {
  const chain = [
    { stage: "install-verify", rec: installVerify },
    { stage: "build", rec: build },
    { stage: "test", rec: test },
  ];
  const first = chain.find((s) => stageFailed(s.rec)) ?? null;
  if (first === null) return { failed: false, disposition: null, stage: null, cause: null };
  const cause = stageCause(first.rec);
  // Benign cause (environment / pre-existing / lockfile-drift, or the 0035/D1
  // test-stage missing-tool / no-tests) → not the edit's fault → blocked.
  // Attributable (dependency-conflict) or unexplained → a genuine regression →
  // broken (the conservative default preserves the existing "a failure with no
  // cause is broken" contract).
  const disposition = isBenignCause(cause) && !isAttributableCause(cause) ? "blocked" : "regression";
  return { failed: true, disposition, stage: first.stage, cause };
}

/**
 * Classify one repo's outcomes. Pure.
 * @param {{url: string|null, ecosystem: string|null, remediations: object[],
 *   installVerify: object|null, build: object|null, test: object|null}} input
 * @returns {object} the per-repo validation record
 */
export function classifyRepo({ url, ecosystem = null, remediations = [], installVerify = null, build = null, test = null }) {
  const downstream = diagnoseDownstream({ installVerify, build, test });
  const verification = verificationEvidence({ installVerify, build, test });
  const packages = [];
  let appliedCount = 0;

  for (const rem of remediations) {
    if (rem?.applied === true) {
      appliedCount += 1;
      const move = `applied ${rem.from ?? "?"}→${rem.to ?? "?"}`;
      if (!downstream.failed && !verification.evidence) {
        // 0051/A3: nothing FAILED because nothing RAN. An applied edit with no
        // install-verify / build / test evidence behind it is unverified, not
        // confirmed — `blocked`, never `fixed`.
        packages.push({
          package: rem.package ?? null,
          status: "blocked",
          reason: `${move}; install-verify/build/test all skipped (${verification.cause}) — no verification evidence, unverified (0051/A3)`,
          from: rem.from ?? null,
          to: rem.to ?? null,
          cause: verification.cause,
        });
      } else if (!downstream.failed) {
        // D1 (0034): never declare `fixed` on an UNCONFIRMED version. Two
        // signals — the install RESOLVED a version below the floor
        // (`installedVersions`), or remediate could not clear a stale manifest
        // pin (`confirmed:false`). Either is a version-blind pass, not a fix.
        const conf = confirmInstalledVersion(rem, installVerify?.installedVersions);
        if ((conf && conf.confirmed === false) || rem.confirmed === false) {
          const observed = conf && conf.confirmed === false ? conf.observed : rem.observed ?? "?";
          const required = conf && conf.confirmed === false ? conf.required : rem.required ?? bareVersion(rem.to) ?? "?";
          packages.push({ package: rem.package ?? null, status: "broken", reason: `${move} but ${observed} < required ${required} (version-blind verify — 0034/D1)`, from: rem.from ?? null, to: rem.to ?? null, observed, required });
        } else {
          const note = conf ? ` (installed ${conf.observed} confirmed)` : "";
          packages.push({ package: rem.package ?? null, status: "fixed", reason: `bumped ${rem.from ?? "?"}→${rem.to ?? "?"}${note}`, from: rem.from ?? null, to: rem.to ?? null, ...(conf ? { confirmed: conf.observed } : {}) });
        }
      } else if (downstream.disposition === "blocked") {
        // Environmental / pre-existing block — the edit is correct, the
        // environment (or a pre-existing break) is what failed. NOT `broken`.
        packages.push({ package: rem.package ?? null, status: "blocked", reason: `${move}; ${downstream.stage} ${describeCause(downstream.cause)} — not a remediation regression`, from: rem.from ?? null, to: rem.to ?? null, cause: downstream.cause });
      } else {
        const detail = downstream.cause ? ` (${describeCause(downstream.cause)})` : "";
        packages.push({ package: rem.package ?? null, status: "broken", reason: `${move} but ${downstream.stage} failed${detail}`, from: rem.from ?? null, to: rem.to ?? null });
      }
      continue;
    }
    // Not applied → classify the skip reason.
    const status = classifySkipReason(rem?.skipReason);
    packages.push({ package: rem?.package ?? null, status, reason: rem?.skipReason ?? "skipped", from: rem?.from ?? null, to: rem?.to ?? null });
  }

  // A downstream failure with NO applied remediation is a pre-existing bug the
  // run surfaced — record it once, naming the failed stage.
  if (downstream.failed && appliedCount === 0) {
    const detail = downstream.cause ? ` (${describeCause(downstream.cause)})` : "";
    packages.push({ package: null, status: "bug", reason: `${downstream.stage} failed with no remediation applied (pre-existing)${detail}`, from: null, to: null });
  }

  const outcomes = { fixed: 0, broken: 0, blocked: 0, skipped: 0, bug: 0 };
  for (const p of packages) if (Object.hasOwn(outcomes, p.status)) outcomes[p.status] += 1;

  let overall;
  if (outcomes.broken > 0 || outcomes.bug > 0) overall = "failed";
  else if (outcomes.fixed > 0) overall = outcomes.blocked > 0 ? "attention" : "clean";
  else if (outcomes.blocked > 0) overall = "blocked";
  else overall = "noop";

  return {
    repo: url,
    url,
    ecosystem,
    overall,
    outcomes,
    packages,
    stages: {
      installVerify: stageStatus(installVerify),
      build: stageStatus(build),
      test: stageStatus(test),
    },
  };
}

export function remediationValidate(params, ctx) {
  let logger = null;
  return async (state) => {
    if (logger === null) {
      const logRel = params.decision_log ?? null;
      logger = createDecisionLogger({
        path: logRel === null ? null : isAbsolute(logRel) ? logRel : resolve(ctx.options.baseDir, logRel),
        mock: ctx.options.mock === true,
        stage: "datasource-contract",
      });
    }
    const remediations = Array.isArray(state[params.remediations_from]) ? state[params.remediations_from] : [];
    const verifications = params.install_verifications_from && Array.isArray(state[params.install_verifications_from]) ? state[params.install_verifications_from] : [];
    const builds = params.builds_from && Array.isArray(state[params.builds_from]) ? state[params.builds_from] : [];
    const tests = params.tests_from && Array.isArray(state[params.tests_from]) ? state[params.tests_from] : [];
    const plans = params.plans_from && Array.isArray(state[params.plans_from]) ? state[params.plans_from] : [];

    const byUrl = (list, key = "url") => {
      const map = new Map();
      for (const rec of list) {
        const norm = normalizeRepoUrl(String(rec?.[key] ?? ""));
        if (norm !== null && !map.has(norm)) map.set(norm, rec);
      }
      return map;
    };
    const verifyByUrl = byUrl(verifications);
    const buildByUrl = byUrl(builds);
    const testByUrl = byUrl(tests);
    const planByUrl = byUrl(plans, "url");

    // Group remediations by repo, preserving first-seen order.
    const remByUrl = new Map();
    const order = [];
    for (const rem of remediations) {
      const norm = normalizeRepoUrl(String(rem?.repo ?? ""));
      const key = norm ?? ` ${rem?.dir ?? "unknown"}`;
      if (!remByUrl.has(key)) {
        remByUrl.set(key, { url: rem?.repo ?? null, list: [] });
        order.push(key);
      }
      remByUrl.get(key).list.push(rem);
    }
    // Fold in any planned repo that produced no remediation record at all.
    for (const [norm] of planByUrl) {
      if (!remByUrl.has(norm)) {
        remByUrl.set(norm, { url: planByUrl.get(norm)?.url ?? null, list: [] });
        order.push(norm);
      }
    }

    const validations = [];
    const total = order.length;
    let index = 0;
    for (const key of order) {
      index += 1;
      ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });
      const { url, list } = remByUrl.get(key);
      const norm = normalizeRepoUrl(String(url ?? ""));
      const ecosystem = (norm && planByUrl.get(norm)?.ecosystem) ?? null;
      try {
        validations.push(
          classifyRepo({
            url,
            ecosystem,
            remediations: list,
            installVerify: norm ? verifyByUrl.get(norm) ?? null : null,
            build: norm ? buildByUrl.get(norm) ?? null : null,
            test: norm ? testByUrl.get(norm) ?? null : null,
          }),
        );
      } catch (err) {
        // Never throw — a classification error is itself a recorded finding.
        validations.push({ repo: url, url, ecosystem, overall: "failed", outcomes: { fixed: 0, broken: 0, blocked: 0, skipped: 0, bug: 1 }, packages: [{ package: null, status: "bug", reason: `classification error: ${err.message}` }], stages: {} });
      }
    }
    // 0032/D7 — contract C1 over the datasource rows. Attached per matching
    // repo record (violations surface in the reports) + one summary record
    // when any row was checked; every verdict is a decision line.
    const dataset = params.dataset_from ? state[params.dataset_from] ?? {} : {};
    const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
    const c1 = checkDatasourceContract(rows, remediations);
    if (c1.checked > 0) {
      for (const validation of validations) {
        const norm = normalizeRepoUrl(String(validation?.url ?? ""));
        const violations = c1.violations.filter((v) => normalizeRepoUrl(String(v.repo ?? "")) === norm);
        validation.contractC1 = { violations };
      }
      for (const violation of c1.violations) {
        await logger.log({ decision: "contract", contract: "C1", repo: violation.repo, package: violation.package, satisfied: false, reason: violation.reason });
      }
      await logger.log({ decision: "contract-summary", contract: "C1", checked: c1.checked, satisfied: c1.satisfied, violations: c1.violations.length });
    }
    return { [params.into]: validations };
  };
}
