/**
 * commands.testRun — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the `test` stage
 * (langgraph-flow.md capability 1 — "test it, if present"). A faithful MIRROR of
 * `commands.buildRun` (0029/D1) — the pack's proven template for guarded,
 * bounded, argv-list, artifact-saving, exit-code-honest per-repo execution —
 * pointed at the per-ecosystem TEST playbooks
 * (`configs/playbooks/ecosystem-test/<ecosystem>/test.yaml`) instead of build
 * commands.
 *
 * AUTHORITY BOUNDARY (0026/A3): the LLM-detected `integrated[].test` shell
 * strings are EVIDENCE, never an execution plan. This atom NEVER executes them
 * (security rules §1/§2/§4). Execution comes exclusively from the repo-reviewed,
 * argv-list playbooks selected by the fingerprint-derived `modules[].ecosystem`;
 * a divergence between the LLM's evidence and the playbook argv is recorded as an
 * INFORMATIONAL finding.
 *
 * "IF PRESENT" honesty: the node lane runs `npm run test --if-present`, so a repo
 * with no test script is a clean no-op (status "ok", no executed step), never a
 * failure. Other ecosystems' test commands exit non-zero for "no tests" and that
 * exit code is a RECORDED outcome (0025/A1), not an exception.
 *
 * Real-vs-mock contract (platform rule 3 + security rule §8): under `--mock`
 * (default) the atom is a pure state transform returning one deterministic
 * `{ placeholder: true, repo, url, dir, locations: [], steps: [],
 * status: "skipped" }` stub per integrated entry — no fs, no subprocess, no
 * network, no LLM. Real test runs need an installed + built tree, so they run
 * only outside the default verify gate.
 *
 * Ordering note: this stage runs AFTER build/build_snapshot (a test needs the
 * built tree) and feeds `commands.remediationValidate`, which classifies a
 * broken test into the per-repo outcome ledger (capability 6).
 *
 * REGISTRY GATE (0063/A2, completing 0054): the run-scoped preflight
 * (commands.registryPreflight, consumed via `preflight_from`) gates every step
 * whose argv can cause an index fetch (laneForArgv). A dead lane records
 * `skipped: "registry-unreachable"`, `cause: "environment"` → the repo is
 * `blocked`, never `ok` on the strength of the ungated steps and never a test
 * failure. No reroute, ever (0054/D1 note).
 *
 * Trust boundary: lives under `configs/patterns/`; imports only the pack's own
 * `src/` bridges. `playbooks_dir` resolves against the flow dir — never a
 * host-absolute path in yaml.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join, resolve, sep } from "node:path";

import { parseFlowConfig, runArgv } from "../../src/sdk.mjs";
import { detectToolchain } from "../../src/ecosystem-registry.mjs";
import { moduleSlug } from "../../src/repo-modules.mjs";
import { classifyFailureText, describeCause, pickCause } from "../../src/diagnose-lib.mjs";
import { laneForArgv, unreachableLanes } from "../../src/registry-preflight.mjs";
import { rescueSpecFor } from "../../src/playbook-lib.mjs";

/** Bound the per-repo location fan-out — recorded, never silent (0026/D1). */
const DEFAULT_MAX_LOCATIONS = 25;
/** A test run is the same order of magnitude as a build (mvn test, jest). */
const DEFAULT_TIMEOUT_MS = 600000;

/** Shell metacharacters that must never appear in a playbook argv token (D2 §2). */
const FORBIDDEN_TOKEN_CHARS = /[&|;<>`\n]/;

export const meta = {
  name: "commands.testRun",
  category: "commands",
  summary:
    "Test stage: run the per-ecosystem test playbook at each integrated repo's install locations (guarded, bounded, argv-list, artifact-saving, exit-code honest); deterministic per-repo stub under mock.",
  params: {
    type: "object",
    required: ["integrated_from", "clones_from", "playbooks_dir", "into"],
    properties: {
      integrated_from: { type: "string", minLength: 1 },
      clones_from: { type: "string", minLength: 1 },
      playbooks_dir: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      fingerprints_from: { type: "string" },
      // 0063/A2: optional channel holding the RUN-SCOPED registry preflight
      // (commands.registryPreflight) — a step whose argv can cause an index
      // fetch is skipped when its lane is dead (`blocked`, never `broken`).
      preflight_from: { type: "string" },
      save_dir: { type: "string" },
      max_locations: { type: "integer", minimum: 1 },
      timeout_ms: { type: "integer", minimum: 1 },
    },
  },
  returns: "node",
};

const exists = (path) => access(path).then(() => true, () => false);

/** PATH probe — a path-y guard (contains a separator) resolves against `cwd`. */
async function defaultProbe(bin, cwd = ".") {
  if (bin.includes(sep) || bin.includes("/")) {
    return exists(isAbsolute(bin) ? bin : resolve(cwd, bin));
  }
  for (const d of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    if (await exists(join(d, bin))) return true;
  }
  return false;
}

/**
 * 0035/A2: does a step's guard pass? A plain `guard` string is a PATH probe (the
 * tool's binary exists). A `guardArgv` is a probe COMMAND — the tool must be
 * RUNNABLE: `python3 -c 'import pytest'` confirms pytest is importable by THAT
 * interpreter, not merely that a `python3` binary is on PATH, so the pip fallback
 * can never select an interpreter that lacks pytest and then manufacture a
 * `No module named pytest` failure the edit had nothing to do with. The argv
 * guard runs through the same argv-list runner (never a shell); the guard binary
 * must still be on PATH first, and a non-zero or thrown probe fails closed.
 */
async function guardOk(step, { cwd, probe, runner, timeoutMs }) {
  if (Array.isArray(step.guardArgv) && step.guardArgv.length > 0) {
    if (!(await probe(step.guardArgv[0], cwd))) return false;
    try {
      const { exitCode } = await runner(step.guardArgv, { cwd, timeoutMs, allowNonZero: true });
      return exitCode === 0;
    } catch {
      return false;
    }
  }
  return probe(step.guard, cwd);
}

/** Validate one playbook step (or a `fallback:`) against the D2 hard constraints. */
function validateStep(step, where) {
  if (!step || typeof step !== "object") throw new Error(`${where}: step must be a mapping`);
  if (typeof step.tool !== "string" || step.tool.length === 0) throw new Error(`${where}: 'tool' must be a non-empty string`);
  if (!Array.isArray(step.argv) || step.argv.length === 0) throw new Error(`${where}: 'argv' must be a non-empty list (security rule §4)`);
  for (const token of step.argv) {
    if (typeof token !== "string") throw new Error(`${where}: argv tokens must be literal strings`);
    if (FORBIDDEN_TOKEN_CHARS.test(token)) {
      throw new Error(`${where}: argv token ${JSON.stringify(token)} carries shell metacharacters — argv lists never reach a shell (security rule §4)`);
    }
  }
  if (typeof step.guard !== "string" || step.guard.length === 0) throw new Error(`${where}: 'guard' (the probed CLI) is required`);
  // 0035/A2: an optional argv guard — a probe COMMAND (e.g.
  // `python3 -c 'import pytest'`) that confirms the tool is RUNNABLE by that
  // interpreter, not merely that a binary is on PATH. Same argv-list hardening as
  // `argv` (security rule §4: literal strings, never a shell). `guard` stays the
  // required PATH pre-check on the guard binary.
  if (step.guardArgv !== undefined) {
    if (!Array.isArray(step.guardArgv) || step.guardArgv.length === 0) throw new Error(`${where}: 'guardArgv' must be a non-empty list when present`);
    for (const token of step.guardArgv) {
      if (typeof token !== "string") throw new Error(`${where}: guardArgv tokens must be literal strings`);
      if (FORBIDDEN_TOKEN_CHARS.test(token)) {
        throw new Error(`${where}: guardArgv token ${JSON.stringify(token)} carries shell metacharacters — argv lists never reach a shell (security rule §4)`);
      }
    }
  }
  if (typeof step.artifact !== "string" || step.artifact.length === 0) throw new Error(`${where}: 'artifact' is required`);
  if (step.allowNonZero !== true) throw new Error(`${where}: 'allowNonZero: true' is required on every step — the exit code is a RECORDED outcome (0025/A1)`);
  // 0035/A1: optional list of exit codes that mean "ran fine, nothing to do"
  // (e.g. pytest 5 = no tests collected) — recorded as a no-op, never a failure.
  if (step.noopExitCodes !== undefined && (!Array.isArray(step.noopExitCodes) || step.noopExitCodes.some((c) => !Number.isInteger(c)))) {
    throw new Error(`${where}: 'noopExitCodes' must be a list of integers`);
  }
  if (step.fallback !== undefined) validateStep(step.fallback, `${where}.fallback`);
}

/**
 * Load + validate one ecosystem's TEST playbook yaml (filename `test.yaml`, same
 * schema as the 0026/D2 install + 0029/D1 build playbooks). Parsed through the
 * vendored SDK loader's own YAML reader, pre-env-interpolation.
 */
export async function loadPlaybook(playbooksDir, ecosystem) {
  const path = join(playbooksDir, ecosystem, "test.yaml");
  if (!(await exists(path))) return null;
  const text = await readFile(path, "utf8");
  const doc = parseFlowConfig(text, { path, dir: join(playbooksDir, ecosystem) }).raw;
  if (doc.ecosystem !== ecosystem) {
    throw new Error(`playbook ${path}: 'ecosystem: ${doc.ecosystem}' must equal its directory name '${ecosystem}'`);
  }
  const toolchains = doc.toolchains ?? {};
  if (typeof toolchains !== "object" || Array.isArray(toolchains)) throw new Error(`playbook ${path}: 'toolchains' must be a mapping`);
  for (const [toolchain, steps] of Object.entries(toolchains)) {
    if (!Array.isArray(steps)) throw new Error(`playbook ${path}: toolchains.${toolchain} must be a step list`);
    steps.forEach((step, i) => {
      validateStep(step, `playbook ${path}: toolchains.${toolchain}[${i}]`);
    });
  }
  return { ecosystem, reason: typeof doc.reason === "string" ? doc.reason : null, toolchains, path };
}

/**
 * "What do I test for this location?" — the same two-tier lookup as build/install
 * (0026/D4): tier 1 (a repo-specific test definition) is OUT OF SCOPE; tier 2 is
 * the ecosystem playbook; no playbook → the caller records `skipped: "no-playbook"`.
 */
export async function resolvePlaybook(location, { playbooksDir, cache }) {
  const ecosystem = location?.ecosystem;
  if (typeof ecosystem !== "string" || ecosystem.length === 0) return null;
  if (!cache.has(ecosystem)) cache.set(ecosystem, await loadPlaybook(playbooksDir, ecosystem));
  return cache.get(ecosystem);
}

/** Whole-token placeholder substitution (D2 §3) — fingerprint-derived paths only. */
function substituteToken(token, location) {
  if (token === "{{module.dir}}") return location.dir ?? ".";
  if (token === "{{module.manifest}}") return location.manifest ?? location.dir ?? ".";
  return token;
}

/** Test seam: build the factory over an injected argv runner + CLI probe. */
export function _testRunWith({ runner = runArgv, probe = defaultProbe } = {}) {
  return function testRunFactory(params, ctx) {
    return async (state) => {
      const entries = Array.isArray(state[params.integrated_from]) ? state[params.integrated_from] : [];
      const clones = Array.isArray(state[params.clones_from]) ? state[params.clones_from] : [];
      const fingerprints = params.fingerprints_from && Array.isArray(state[params.fingerprints_from]) ? state[params.fingerprints_from] : [];
      const cloneByUrl = new Map(clones.filter((c) => typeof c?.url === "string").map((c) => [c.url, c]));
      const fpByUrl = new Map(fingerprints.filter((f) => typeof f?.url === "string").map((f) => [f.url, f]));

      const timeoutMs = Number.isInteger(params.timeout_ms) && params.timeout_ms > 0 ? params.timeout_ms : DEFAULT_TIMEOUT_MS;
      const maxLocations = Number.isInteger(params.max_locations) && params.max_locations > 0 ? params.max_locations : DEFAULT_MAX_LOCATIONS;
      const playbookCache = new Map();

      // 0063/A2: consume the RUN-SCOPED registry preflight the flow published
      // upstream (commands.registryPreflight via `preflight_from`) — probed
      // ONCE per flow; this stage only reads.
      const shared = !ctx.options.mock && params.preflight_from ? state[params.preflight_from] : null;
      const preflightResult = shared && shared.placeholder !== true && Array.isArray(shared.checked) ? shared : null;
      const deadLanes = unreachableLanes(preflightResult);
      const laneStatus = new Map((preflightResult?.checked ?? []).map((c) => [c.lane, c]));
      /** Same guard as install-run's 0054/A2 — "can the tool do its job?". */
      const registrySkip = (candidate, location) => {
        const lane = laneForArgv(candidate.argv);
        if (!lane || !deadLanes.has(lane)) return null;
        const status = laneStatus.get(lane);
        return {
          tool: candidate.tool,
          location: location.dir,
          skipped: "registry-unreachable",
          cause: "environment",
          lane,
          registry: status?.endpoint ?? null,
          reason: status?.error ? `${status.endpoint} — ${status.error}` : "registry unreachable",
        };
      };

      const tests = [];
      const total = entries.length;
      let index = 0;
      for (const entry of entries) {
        index += 1;
        ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });

        const url = typeof entry?.url === "string" ? entry.url : null;
        const dir = typeof entry?.dir === "string" && entry.dir.length > 0 ? entry.dir : null;
        const repo = dir ? basename(dir) : "unknown";
        const base = { placeholder: false, repo, url, dir, locations: [], steps: [], status: "skipped", failed: false };

        // Mock (default): pure state transform — no fs, subprocess, network, LLM.
        if (ctx.options.mock) {
          tests.push({ placeholder: true, repo, url, dir, locations: [], steps: [], status: "skipped" });
          continue;
        }

        const cloneError = typeof entry?.cloneError === "string" && entry.cloneError.length > 0
          ? entry.cloneError
          : (() => {
              const clone = url ? cloneByUrl.get(url) : null;
              return clone?.failed === true && typeof clone.errorClass === "string" ? clone.errorClass : null;
            })();
        if (cloneError) {
          tests.push({ ...base, skipped: "clone-failed", errorClass: cloneError });
          continue;
        }
        if (!dir || !(await exists(dir))) {
          tests.push({ ...base, skipped: "no-clone-dir" });
          continue;
        }

        // 0035/A4: the integrate step's `test` array is the authority on whether
        // the repo defines a test command. An array that is PRESENT but empty is
        // its "no test command detected" verdict — honor it as a no-op skip and do
        // NOT guess a fingerprint playbook. This takes the guessing out: the harness
        // never runs (then reverse-engineers the exit code of) a test the integrate
        // step already determined does not exist. Non-empty stays evidence-only —
        // compared for divergence below, never executed (security §1/§2, 0026/A3).
        // Honoring emptiness only gates toward a no-op (the fail-safe direction), so
        // it does not execute untrusted text.
        if (Array.isArray(entry?.test) && entry.test.filter((c) => typeof c === "string" && c.trim().length > 0).length === 0) {
          tests.push({ ...base, skipped: "no-test-command", note: "integrate detected no test command (integrated[].test empty) — 0035/A4" });
          continue;
        }

        const playbooksDir = isAbsolute(params.playbooks_dir) ? params.playbooks_dir : resolve(ctx.options.baseDir, params.playbooks_dir);
        const saveRel = params.save_dir ?? "../../.harness/tests";
        const saveRoot = isAbsolute(saveRel) ? saveRel : resolve(ctx.options.baseDir, saveRel);
        const artifactsDir = join(saveRoot, repo);

        const discovered = Array.isArray(entry?.modules) ? entry.modules.filter((m) => m && typeof m.dir === "string") : [];
        const locations = discovered.slice(0, maxLocations);
        const droppedLocations = discovered.slice(maxLocations).map((m) => m.dir);
        if (droppedLocations.length > 0) {
          ctx.emit?.("loop.guard", { node: ctx.node?.id, count: locations.length, max: discovered.length, kind: "location-cap", dropped: droppedLocations });
        }

        if (locations.length === 0) {
          tests.push({ ...base, skipped: "no-playbook", ecosystem: entry?.ecosystem ?? null });
          continue;
        }

        const fp = url ? fpByUrl.get(url)?.fingerprint ?? null : null;
        const steps = [];
        const findings = [];
        const usedLocations = [];

        for (const location of locations) {
          usedLocations.push(location);
          const playbook = await resolvePlaybook(location, { playbooksDir, cache: playbookCache });
          if (!playbook) {
            steps.push({ tool: null, location: location.dir, skipped: "no-playbook", ecosystem: location.ecosystem });
            continue;
          }
          const toolchainKeys = Object.keys(playbook.toolchains);
          if (toolchainKeys.length === 0) {
            steps.push({ tool: null, location: location.dir, skipped: "no-test-lane", ecosystem: location.ecosystem, reason: playbook.reason });
            continue;
          }
          const detected = fp ? detectToolchain(location.ecosystem, fp) : null;
          const toolchain = detected && playbook.toolchains[detected] ? detected : playbook.toolchains.default ? "default" : null;
          if (!toolchain) {
            steps.push({ tool: null, location: location.dir, skipped: "no-toolchain", ecosystem: location.ecosystem, toolchain: detected });
            continue;
          }

          const cwd = resolve(dir, location.dir === "." ? "" : location.dir);
          const slug = moduleSlug(location);
          const locationDir = slug ? join(artifactsDir, slug) : artifactsDir;
          await mkdir(locationDir, { recursive: true });

          for (const spec of playbook.toolchains[toolchain]) {
            // 0063/A2: a candidate whose argv can cause an index fetch requires
            // its registry lane to be ALIVE before any runnability probe — a dead
            // lane is a recorded skip, never a doomed run or a fabricated failure.
            const registrySkips = [];
            let chosen = null;
            // 0035/A2: `guardOk` honors an argv `guardArgv` (a runnability probe)
            // when present, else the plain `guard` PATH check — so the fallback is
            // selected only when its interpreter can actually run the tool.
            for (const candidate of [spec, spec.fallback]) {
              if (!candidate) continue;
              const dead = registrySkip(candidate, location);
              if (dead) {
                registrySkips.push(dead);
                continue;
              }
              if (await guardOk(candidate, { cwd, probe, runner, timeoutMs })) {
                chosen = candidate;
                break;
              }
            }
            if (!chosen) {
              if (registrySkips.length > 0) {
                steps.push(...registrySkips);
                continue;
              }
              // A2: neither the primary tool nor a runnable fallback interpreter is
              // available — a truthful capability gap recorded as a skip, never a
              // fabricated failure (a genuinely-run missing runner is cause-tagged
              // `missing-tool` → `blocked` by D1/A3 instead).
              steps.push({ tool: spec.tool, location: location.dir, skipped: spec.fallback?.guard ?? spec.guard, reason: "not runnable (guard failed)" });
              continue;
            }
            steps.push(...registrySkips);

            const ran = await runStep(chosen, { cwd, location, locationDir, runner, timeoutMs });
            steps.push(ran);

            // The rescue honors the same registry gate (0063/A2): a rescue that
            // CANNOT work is not attempted — and saying so is a record.
            if (ran.ok === false && chosen === spec && spec.fallback) {
              const unrunnable = registrySkip(spec.fallback, location);
              if (unrunnable) {
                steps.push(unrunnable);
              } else if (await guardOk(spec.fallback, { cwd, probe, runner, timeoutMs })) {
                // 0066/D1: de-collide the rescue's artifact — both pytest rungs
                // declare `pytest.log`, so an un-suffixed rescue would overwrite
                // the primary's failure log with its own success trace.
                const rescue = await runStep(rescueSpecFor(spec), { cwd, location, locationDir, runner, timeoutMs });
                steps.push(rescue);
                if (rescue.ok) ran.recovered = true;
              }
            }
          }
        }

        // 0026/A3: the LLM's test evidence is compared, never executed. A
        // divergence is an INFORMATIONAL finding — advisory role, no authority.
        const llmTest = Array.isArray(entry?.test) ? entry.test.filter((c) => typeof c === "string" && c.length > 0) : [];
        if (llmTest.length > 0) {
          const executed = new Set(steps.filter((s) => Array.isArray(s.argv)).map((s) => s.argv.join(" ")));
          const divergent = llmTest.filter((cmd) => !executed.has(cmd));
          if (divergent.length > 0) {
            findings.push({
              severity: "info",
              note: `llm-detected test evidence diverges from the executed playbook (evidence only, never run — 0026/A3): ${divergent.join(" · ")}`,
            });
          }
        }

        const executedSteps = steps.filter((s) => typeof s.exitCode === "number");
        // 0035/A1: a `noop` step is not a failure; a location whose only executed
        // steps are no-ops tested nothing → `skipped`, not `ok` (nor `failed`).
        const failed = executedSteps.some((s) => s.exitCode !== 0 && !s.recovered && !s.noop);
        const ranReal = executedSteps.filter((s) => !s.noop);
        // 0063/A1 discipline (the record's open item, answered): a step skipped
        // by the registry guard invalidates the stage — the repo is never `ok`
        // on the strength of the ungated steps, and the cause rides the record
        // so validate scores it `blocked`, never `broken`.
        const blocking = failed ? null : steps.find((s) => s.skipped === "registry-unreachable");
        const status = executedSteps.length === 0 || ranReal.length === 0 || blocking ? "skipped" : failed ? "failed" : "ok";
        const result = { ...base, locations: usedLocations, steps, findings, status, failed, artifactsDir };
        if (blocking) {
          result.skipped = blocking.skipped;
          result.cause = blocking.cause;
        }
        // 0035/D1: the dominant cause across the failing (non-recovered) steps —
        // validate's diagnoseDownstream consumes it to tell an environmental test
        // block (missing runner / no tests) from a real regression (0035/A3,
        // mirrors build-run 0029/D1). A benign cause → `blocked`, never `broken`.
        const testCause = failed ? pickCause(executedSteps.filter((s) => s.ok === false && !s.recovered).map((s) => s.cause)) : null;
        if (testCause !== null) {
          result.cause = testCause;
          result.causeDescription = describeCause(testCause);
        }
        if (droppedLocations.length > 0) result.locationsTruncated = { max: maxLocations, discovered: discovered.length, dropped: droppedLocations };
        tests.push(result);
      }
      return { [params.into]: tests };
    };
  };
}

/** Run one playbook step: argv-list, bounded, artifact-saving, exit-code honest. */
async function runStep(spec, { cwd, location, locationDir, runner, timeoutMs }) {
  const argv = spec.argv.map((token) => substituteToken(token, location));
  const { stdout, stderr, exitCode } = await runner(argv, { cwd, timeoutMs, allowNonZero: true });
  const artifact = join(locationDir, spec.artifact);
  await writeFile(artifact, stdout ?? "", "utf8");
  // 0035/A1: a declared no-op exit code (e.g. pytest 5 = no tests collected) is
  // "ran fine, nothing to test" — treated as ok, so it neither fails the stage
  // nor triggers the fallback interpreter.
  const noop = Array.isArray(spec.noopExitCodes) && spec.noopExitCodes.includes(exitCode);
  const record = { tool: spec.tool, location: location.dir, argv, artifact, exitCode, ok: exitCode === 0 || noop };
  if (noop) record.noop = true;
  if (typeof stderr === "string" && stderr.length > 0) {
    record.stderrArtifact = `${artifact}.stderr.txt`;
    await writeFile(record.stderrArtifact, stderr, "utf8");
  }
  // 0035/D1: diagnose a GENUINELY failed (non-noop) test step over the output
  // already in memory — a missing runner (`No module named pytest`) lands in
  // stderr, a "no tests" note in stdout — so validate can tell an environmental
  // capability gap from a real test regression (mirrors build-run 0029/D1). A
  // no-op exit (pytest 5, per A1) is never a failure, so it is never classified.
  if (exitCode !== 0 && !noop) {
    const cause = classifyFailureText(`${stdout ?? ""}\n${stderr ?? ""}`);
    if (cause !== null) record.cause = cause;
  }
  return record;
}

export const testRun = _testRunWith({});
