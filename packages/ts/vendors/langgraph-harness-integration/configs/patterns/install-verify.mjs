/**
 * commands.installVerify — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the step-11
 * `install-verify` stage (change record 0027/D1). It reads the step-10
 * `installs` channel (commands.installRun) and asserts, per repo and per
 * executed install location, that the install actually PRODUCED output — a
 * zero exit code proves the command returned, not that it materialized
 * dependencies. Three read-only assertions per location:
 *
 *   1. package-dir-non-empty — the ecosystem's expected output directory
 *      (`node_modules` / per-location `.venv` / `target`) exists and holds
 *      ≥ 1 entry; and
 *   0. steps-succeeded (0033) — no EXECUTED, non-recovered step exited non-zero.
 *      A skeleton `.venv` from `python -m venv` exists before its `pip install`
 *      even fails `ECONNREFUSED`, so the package-dir check alone cannot see that
 *      failure; the non-zero exit can. Agrees with install-run.mjs:370.
 *   2. installation-log-present — every EXECUTED, non-superseded step produced
 *      EVIDENCE OF RUN: its `artifact` (stdout) OR its `<artifact>.stderr.txt`
 *      sibling is byte-size > 0, OR (0034/A1) it EXITED 0. Three corrections to
 *      the original stdout-only check:
 *        · a step marked `recovered` (its primary failed but a `fallback`
 *          SUCCEEDED — install-run.mjs:344-349) is SKIPPED here: verify the
 *          fallback that actually installed, not the abandoned primary whose
 *          empty stdout log is expected. This was remediation002 Cause C —
 *          lockfile-less repos (batch-csv-npm, multi-repo-npm) whose `npm ci`
 *          wrote a 0-byte stdout then recovered via `npm install`, yet scored
 *          `failed`. (0033)
 *        · a step that wrote ONLY to stderr (common on CLI failure) still RAN —
 *          a non-empty stderr sibling counts as evidence-of-run. (0033)
 *        · a step that EXITED 0 while writing 0 bytes to BOTH streams still
 *          succeeded — `python -m venv .venv` is silent-on-success, so its
 *          0-byte `venv-create.log` no longer forces `ok:false` (0034/A1, the
 *          three-pip false positive of session d37bfa64). Success is still
 *          gated by the package-dir assertion (1); the exit-code-honesty guard
 *          (0) still fails a non-recovered NON-zero step regardless.
 *
 * INSTALLED-VERSION CAPTURE (0034/D1): a SUCCEEDED python step's `Successfully
 * installed …` stdout is parsed into a per-location + per-repo
 * `installedVersions` map (PEP 503-normalized), so the validate stage can
 * confirm the RESOLVED version satisfies the finding's patched floor — a
 * version-blind verify is what let `Jinja2-3.1.2` pass as "fixed" for a 3.1.4
 * floor when the constraint was shadowed by a stale direct pin (0034/A2).
 *
 * DIAGNOSIS (0033, langgraph-flow.md capability 9): when a location fails, the
 * failed steps' captured output is read (bounded) and classified via
 * `src/diagnose-lib.mjs` into `environment` (registry down) / `toolchain`
 * (pre-existing) / `lockfile-drift` / `dependency-conflict`. The dominant cause
 * is attached as `verification.cause`, so the pure validate stage can tell an
 * environmental block from a remediation regression WITHOUT doing I/O itself.
 *
 * NON-GATING (0027/A1 + D1 note): this is a pass-through gate. An empty package
 * dir or a missing/zero-byte log is a RECORDED `failed` finding on the result —
 * NEVER an exception and NEVER a pipeline abort. It mirrors install-run.mjs's
 * "a BUILD FAILURE is a recorded finding, never a silent success"
 * (install-run.mjs:38-40); the depgraph fan-out (step 12) still runs, it just
 * now has evidence of whether the tree it inventories was actually populated.
 *
 * READ-ONLY / no execution (platform rule 2, security rules §4/§8): the atom
 * only `stat`s directories and files — no subprocess, no argv, no provider SDK,
 * no LLM. There is nothing here to interpolate a shell string into.
 *
 * Real-vs-mock contract (platform rule 3 + security rule §8): under `--mock`
 * (default) it is a pure state transform returning one deterministic
 * `{ placeholder: true, repo, url, dir, locations: [], status: "skipped" }`
 * stub per install record — no fs, no subprocess, no network — so it passes the
 * offline verify gate (mirrors install-run.mjs:237-241). Asserting an
 * actually-populated `node_modules` only exercises outside the default gate.
 *
 * Package-dir contract per ecosystem GROUP (repo-modules.installLocations tags
 * each location with the step-9 lane group, ecosystem-registry.mjs:104):
 *   - node   → `<location>/node_modules`
 *   - python → `<location>/.venv` — the PER-LOCATION venv install-run writes
 *              with cwd at the install location (0026/A4; the python playbook's
 *              `.venv` is location-relative, not a shared session venv), which
 *              generalizes 0027/D1's `<clone>/.venv` to nested modules.
 *   - java   → `<location>/target` (best-effort; when artifacts land only in a
 *              shared `~/.m2` cache the dir is absent and recorded
 *              `indeterminate`, never a failure — 0027/D1 note).
 *   - golang/docker/other → no per-location package-dir contract → recorded
 *     `indeterminate` (deferred tier-1 per-ecosystem contract, 0027/D1 note).
 *
 * Trust boundary: lives under `configs/patterns/`; imports only node builtins.
 * `save_dir` resolves against the flow dir — never a host-absolute path in yaml.
 */

import { access, readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import { classifyFailureText, describeCause, pickCause } from "../../src/diagnose-lib.mjs";
import { normalizePipName } from "../../src/manifest-edit-ext.mjs";

/** Bounded read of a failed step's captured output for cause diagnosis (0033). */
const DIAGNOSE_MAX_BYTES = 65536;

export const meta = {
  name: "commands.installVerify",
  category: "commands",
  summary:
    "Step-11 install-verify stage: assert each step-10 install produced non-empty package output + non-empty logs (read-only, non-gating, exit-code honest); deterministic per-repo stub under mock.",
  params: {
    type: "object",
    required: ["installs_from", "clones_from", "into"],
    properties: {
      // Channel holding the step-10 install records (commands.installRun).
      installs_from: { type: "string", minLength: 1 },
      // Channel holding the clone results — a fallback source for a repo's
      // clone dir when the install record didn't carry one.
      clones_from: { type: "string", minLength: 1 },
      // Channel the per-repo verification results are written into.
      into: { type: "string", minLength: 1 },
      // Root of the step-10 per-repo log artifacts (0025/D1), resolved against
      // the flow dir. Default: ../../.harness/installs. Used to reconstruct a
      // log path only when a step record didn't carry an absolute `artifact`.
      save_dir: { type: "string" },
    },
  },
  returns: "node",
};

const exists = (path) => access(path).then(() => true, () => false);

/** Bytes of a file, or null when it does not exist / is not a regular file. */
async function fileBytes(path) {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

/** Bounded read of a captured-output file (up to DIAGNOSE_MAX_BYTES), "" on any error. */
async function readBounded(path) {
  if (typeof path !== "string" || path.length === 0) return "";
  try {
    const text = await readFile(path, "utf8");
    return text.length > DIAGNOSE_MAX_BYTES ? text.slice(0, DIAGNOSE_MAX_BYTES) : text;
  } catch {
    return "";
  }
}

/**
 * 0034/D1: parse the versions pip actually installed from a `pip install`
 * stdout — `Successfully installed Jinja2-3.1.4 MarkupSafe-2.1.5`. Keyed by
 * PEP 503-normalized name so the validate stage can confirm the RESOLVED
 * version satisfies the patched floor: a version-blind verify is what let
 * `Successfully installed Jinja2-3.1.2` pass as "fixed" against a 3.1.4 floor.
 * Best-effort + pure — each token is split on its LAST hyphen (so
 * `types-requests-2.31.0` → `types-requests` / `2.31.0`), and unrecognized
 * output yields `{}`.
 */
export function parsePipInstalled(text) {
  const out = {};
  if (typeof text !== "string" || text.length === 0) return out;
  const m = text.match(/Successfully installed ([^\n]+)/);
  if (!m) return out;
  for (const token of m[1].trim().split(/\s+/)) {
    const dash = token.lastIndexOf("-");
    if (dash <= 0) continue;
    const version = token.slice(dash + 1);
    if (/^\d/.test(version)) out[normalizePipName(token.slice(0, dash))] = version;
  }
  return out;
}

/**
 * The ecosystem's expected package-output directory for one location, or null
 * when the group carries no per-location package-dir contract (golang/docker/
 * other). `indeterminateIfAbsent` marks java's `target`, which is legitimately
 * absent when artifacts land only in the shared `~/.m2` cache (0027/D1 note).
 */
function expectedPackageDir(ecosystem, locAbs) {
  switch (ecosystem) {
    case "node":
      return { path: join(locAbs, "node_modules"), indeterminateIfAbsent: false };
    case "python":
      return { path: join(locAbs, ".venv"), indeterminateIfAbsent: false };
    case "java":
      return { path: join(locAbs, "target"), indeterminateIfAbsent: true };
    default:
      return null;
  }
}

/** Stat one location's package dir into the recorded fields (read-only). */
async function checkPackageDir(ecosystem, locAbs) {
  const expected = expectedPackageDir(ecosystem, locAbs);
  if (!expected) {
    // No per-location package-dir contract for this group — indeterminate, not
    // a failure (deferred tier-1 per-ecosystem contract, 0027/D1 note).
    return { packageDir: null, packageDirPresent: false, packageDirEntryCount: 0, packageDirEmpty: false, packageDirIndeterminate: true };
  }
  const present = await exists(expected.path);
  if (!present) {
    // java `target` absent → `~/.m2` cache, indeterminate; else an empty tree.
    return {
      packageDir: expected.path,
      packageDirPresent: false,
      packageDirEntryCount: 0,
      packageDirEmpty: !expected.indeterminateIfAbsent,
      packageDirIndeterminate: expected.indeterminateIfAbsent,
    };
  }
  let entryCount;
  try {
    entryCount = (await readdir(expected.path)).length;
  } catch {
    entryCount = 0;
  }
  return { packageDir: expected.path, packageDirPresent: true, packageDirEntryCount: entryCount, packageDirEmpty: entryCount === 0, packageDirIndeterminate: false };
}

/** Test seam: build the factory (no injected deps today — pure fs reads). */
export function _installVerifyWith() {
  return function installVerifyFactory(params, ctx) {
    return async (state) => {
      const installs = Array.isArray(state[params.installs_from]) ? state[params.installs_from] : [];
      const clones = Array.isArray(state[params.clones_from]) ? state[params.clones_from] : [];
      const cloneByUrl = new Map(clones.filter((c) => typeof c?.url === "string").map((c) => [c.url, c]));

      const saveRel = params.save_dir ?? "../../.harness/installs";
      const saveRoot = isAbsolute(saveRel) ? saveRel : resolve(ctx.options.baseDir, saveRel);

      const verifications = [];
      const total = installs.length;
      let index = 0;
      for (const install of installs) {
        // One bounded, idempotent progress tick per repo, BEFORE any branch —
        // the same loop.guard seam install-run.mjs uses so the animated bar
        // advances on every path (no pristine-SDK edit).
        index += 1;
        ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });

        const url = typeof install?.url === "string" ? install.url : null;
        const clone = url ? cloneByUrl.get(url) : null;
        const dir = (typeof install?.dir === "string" && install.dir.length > 0 ? install.dir : null) ?? (typeof clone?.dir === "string" ? clone.dir : null);
        const repo = typeof install?.repo === "string" ? install.repo : dir ? basename(dir) : "unknown";

        // Mock (default): pure state transform — no fs, subprocess, network.
        if (ctx.options.mock) {
          verifications.push({ placeholder: true, repo, url, dir, locations: [], status: "skipped" });
          continue;
        }

        // Vacuous verification: the install record itself ran nothing (mock
        // stub, clone-failed / no-clone-dir / no-playbook skip, docker no-op).
        // Verifying an install that never executed is meaningless — record
        // `skipped`, never a spurious `failed`.
        if (install?.placeholder === true || install?.status === "skipped" || typeof install?.skipped === "string") {
          const vacuous = { repo, url, dir, locations: [], status: "skipped", failed: false };
          // 0054/D1 §4: when the install stage skipped a repo for a DIAGNOSED
          // reason (registry unreachable, breaker open — cause `environment`),
          // carry that cause through, so validate's 0051/A3 evidence gate scores
          // the repo `blocked` on the real cause instead of a bare "not run".
          if (typeof install?.cause === "string" && install.cause.length > 0) vacuous.cause = install.cause;
          verifications.push(vacuous);
          continue;
        }

        const cloneDir = dir;
        // Map each install location's dir → its ecosystem group (installLocations
        // tagged them at step 10); a step whose location isn't listed falls back
        // to `null` → indeterminate rather than a guessed contract.
        const ecoByDir = new Map((Array.isArray(install?.locations) ? install.locations : []).filter((l) => typeof l?.dir === "string").map((l) => [l.dir, typeof l.ecosystem === "string" ? l.ecosystem : null]));

        // Group the EXECUTED steps (exit code recorded) by their location dir —
        // a location with only skipped steps executed nothing to verify.
        const steps = Array.isArray(install?.steps) ? install.steps : [];
        const executedByLocation = new Map();
        for (const step of steps) {
          if (typeof step?.exitCode !== "number") continue;
          const key = typeof step.location === "string" ? step.location : ".";
          if (!executedByLocation.has(key)) executedByLocation.set(key, []);
          executedByLocation.get(key).push(step);
        }

        const locations = [];
        for (const [locationDir, locSteps] of executedByLocation) {
          const ecosystem = ecoByDir.has(locationDir) ? ecoByDir.get(locationDir) : null;
          const locAbs = cloneDir ? resolve(cloneDir, locationDir === "." ? "" : locationDir) : locationDir;
          const pkg = await checkPackageDir(ecosystem, locAbs);

          const logs = [];
          const failedStepTexts = [];
          const installedVersions = {};
          for (const step of locSteps) {
            // A step superseded by a SUCCESSFUL fallback (install-run marks it
            // `recovered`) is not the install of record — verify the fallback,
            // not the abandoned primary whose empty stdout log is expected.
            if (step?.recovered === true) continue;
            const artifactPath = typeof step.artifact === "string" && step.artifact.length > 0
              ? (isAbsolute(step.artifact) ? step.artifact : resolve(saveRoot, step.artifact))
              : null;
            const bytes = artifactPath ? await fileBytes(artifactPath) : null;
            const stderrPath = artifactPath ? `${artifactPath}.stderr.txt` : null;
            const stderrBytes = stderrPath ? await fileBytes(stderrPath) : null;
            const stdoutOk = typeof bytes === "number" && bytes > 0;
            const stderrOk = typeof stderrBytes === "number" && stderrBytes > 0;
            // 0034/A1: a step that EXITED 0 is evidence-of-success even when it
            // wrote 0 bytes to BOTH streams — `python -m venv .venv` succeeds
            // silently, so its 0-byte `venv-create.log` must not on its own force
            // `ok:false`. Success stays gated by `packageDirOk` (the tree
            // materialized) and `!stepFailed`; the 0033 exit-code-honesty guard
            // (a non-recovered NON-zero step) is untouched — it still fails via
            // `stepFailed` below regardless of what it wrote.
            const exitedZero = step?.ok === true || step?.exitCode === 0;
            logs.push({
              artifact: artifactPath ? basename(artifactPath) : null,
              // Evidence-of-run: a stdout-silent step that wrote stderr, or a
              // clean silent exit, still ran (0033 stderr + 0034/A1 exit-zero).
              present: stdoutOk || stderrOk || exitedZero,
              bytes: typeof bytes === "number" ? bytes : 0,
              stderrBytes: typeof stderrBytes === "number" ? stderrBytes : 0,
            });
            // Collect a FAILED step's captured output for cause diagnosis below.
            if (step?.ok === false || (typeof step?.exitCode === "number" && step.exitCode !== 0)) {
              const out = await readBounded(artifactPath);
              const err = await readBounded(stderrPath);
              const text = `${out}\n${err}`;
              if (text.trim().length > 0) failedStepTexts.push(text);
            } else if (ecosystem === "python") {
              // 0034/D1: a SUCCEEDED pip install names what it resolved on its
              // stdout — capture those versions so validate can confirm the
              // patched floor actually landed (never `fixed` on a stale version).
              Object.assign(installedVersions, parsePipInstalled(await readBounded(artifactPath)));
            }
          }

          const packageDirOk = pkg.packageDirIndeterminate || (pkg.packageDirPresent && !pkg.packageDirEmpty);
          const logsOk = logs.length > 0 && logs.every((l) => l.present);
          // Exit-code honesty (0033): a non-recovered non-zero step means the
          // install did NOT complete, so a stale / skeleton package dir must not
          // read as success — e.g. an empty `python -m venv` that exists before
          // its `pip install` failed `ECONNREFUSED` against the down index. This
          // agrees install-verify with install-run's own `failed` computation
          // (install-run.mjs:370) and adds the materialization check on top.
          const stepFailed = locSteps.some((s) => s?.recovered !== true && (s?.ok === false || (typeof s?.exitCode === "number" && s.exitCode !== 0)));
          const ok = packageDirOk && logsOk && !stepFailed;
          // Diagnose WHY a failed location failed (capability 9) — pure text
          // classification over the bounded step output read just above.
          const cause = ok ? null : pickCause(failedStepTexts.map((t) => classifyFailureText(t)));
          const locRecord = { dir: locationDir, ecosystem, ...pkg, logs, ok, cause };
          if (Object.keys(installedVersions).length > 0) locRecord.installedVersions = installedVersions;
          locations.push(locRecord);
        }

        const failed = locations.some((l) => l.ok === false);
        // The dominant cause across all failed locations — validate consumes it
        // to separate an environmental / pre-existing block from a regression.
        const installCause = failed ? pickCause(locations.filter((l) => l.ok === false).map((l) => l.cause)) : null;
        // No executed locations at all (every step skipped upstream) is vacuous,
        // not a failure — record `skipped`, consistent with install-run's status.
        const status = locations.length === 0 ? "skipped" : failed ? "failed" : "ok";
        const record = { repo, url, dir, locations, status, failed };
        // 0034/D1: repo-level roll-up of the versions pip actually installed —
        // what validate confirms the patched floor against.
        const mergedInstalled = {};
        for (const l of locations) Object.assign(mergedInstalled, l.installedVersions ?? {});
        if (Object.keys(mergedInstalled).length > 0) record.installedVersions = mergedInstalled;
        if (installCause !== null) {
          record.cause = installCause;
          record.causeDescription = describeCause(installCause);
        }
        verifications.push(record);
      }
      return { [params.into]: verifications };
    };
  };
}

export const installVerify = _installVerifyWith();
