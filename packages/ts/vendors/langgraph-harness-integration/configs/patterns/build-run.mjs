/**
 * commands.buildRun — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the step-13 `build`
 * stage (change record 0029/D1) — loop over the integrated repos, resolve each
 * repo's build locations (`integrated[].modules`, ecosystem-tagged per
 * 0026/A2 — the SAME locations the install stage materialized), and run the
 * matching declarative ecosystem-build playbook
 * (`configs/playbooks/ecosystem-build/<ecosystem>/build.yaml`) at each
 * location. Mirrors `commands.installRun` (0026/D1) — the pack's proven
 * template for guarded, bounded, argv-list, artifact-saving, exit-code-honest
 * per-repo execution — pointed at compile/package commands instead of
 * dependency installs.
 *
 * AUTHORITY BOUNDARY (0026/A3, reaffirmed by 0029/D1): any LLM-detected
 * `integrated[].build`-style evidence — shell strings detected over untrusted
 * repo excerpts — is EVIDENCE, never an execution plan. This atom NEVER
 * executes it (security rules §1/§2/§4). Execution comes exclusively from the
 * repo-authored, reviewed, argv-list playbooks, selected by the
 * fingerprint-derived `modules[].ecosystem`; a divergence between the LLM's
 * evidence and the playbook's argv is recorded as an INFORMATIONAL finding.
 * Do not "simplify" this atom by piping LLM output into a shell.
 *
 * FALLBACK TIER (0026/D4 discipline): build resolution is the same two-tier
 * lookup as install, of which only tier 2 (the ecosystem playbook) is
 * implemented. Tier 1 (a repo-specific build definition) is OUT OF SCOPE;
 * when it lands it overrides (never merges with) the playbook, and it may
 * never be LLM-detected evidence.
 *
 * Real-vs-mock contract (platform rule 3 + security rule §8): under `--mock`
 * (default) the atom is a pure state transform returning one deterministic
 * `{ placeholder: true, repo, url, dir, locations: [], steps: [],
 * status: "skipped" }` stub per integrated entry — no fs, no subprocess, no
 * network, no LLM. `npm run build` / `mvn package` need an installed tree
 * (and often network), so real builds run only outside the default verify gate.
 *
 * Exit-code honesty (0025/A1, non-negotiable): every playbook step carries
 * `allowNonZero: true` — the atom never throws — and each step record carries
 * `{ tool, location, argv, artifact, exitCode, ok }`; the per-repo result
 * carries `status` ("ok" | "failed" | "skipped") + `failed`. A BUILD FAILURE
 * never presents as a clean build. Raw stdout goes to
 * `<save_dir>/<repo>/[<location-slug>/]<artifact>`, with a
 * `<artifact>.stderr.txt` sibling when stderr is non-empty (0025/D1).
 *
 * Cause diagnosis (0033, langgraph-flow.md capability 9): a failed step's
 * output is classified via `src/diagnose-lib.mjs` into `toolchain` (a
 * pre-existing `tsc` deprecation like remediation002 Cause D) / `environment` /
 * `dependency-conflict`; the dominant cause is attached as `build.cause` so the
 * pure validate stage can tell a pre-existing build break from a regression the
 * edit caused — the same signal install-verify attaches for the install stage.
 *
 * Ordering note (0029/D1): this stage runs AFTER install/install_verify (it
 * builds the INSTALLED tree — `npm run build` without node_modules fails, and
 * that failure would be honest but useless) and is followed by the step-14
 * `build_snapshot` so the post-build tree is inventoried.
 *
 * REGISTRY GATE (0063/A2, completing 0054): the run-scoped preflight
 * (commands.registryPreflight, consumed via `preflight_from`) gates every step
 * whose argv can CAUSE an index fetch (laneForArgv, 0063/A3 — `python3 -m
 * build` bootstraps a PEP-517 env from the index). A dead lane records
 * `skipped: "registry-unreachable"`, `cause: "environment"` → the repo is
 * `blocked`, never a build failure. No reroute, ever (0054/D1 note).
 *
 * HERMETIC-TOOLCHAIN GUARD (0063/D1): a node module whose manifest declares
 * dependencies but whose tree holds no `node_modules` (install skipped/failed)
 * must NEVER silently resolve its build tools from an ancestor directory —
 * the clones live inside the harness's own npm workspace, so `npm run build`
 * would borrow the HARNESS's compiler (tsc 6.0.3 over a pinned 5.3.3 →
 * TS5107) and report a build verdict for a toolchain the repo never asked
 * for. The module is `blocked` (`skipped: "toolchain-not-installed"`,
 * `cause: "environment"`) instead; when the tree IS installed, the child runs
 * with the module's own `node_modules/.bin` first on PATH.
 *
 * Trust boundary: lives under `configs/patterns/`; imports only the pack's own
 * `src/` bridges. `playbooks_dir` resolves against the flow dir — never a
 * host-absolute path in yaml.
 */

import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";

import { parseFlowConfig, runArgv } from "../../src/sdk.mjs";
import { detectToolchain } from "../../src/ecosystem-registry.mjs";
import { moduleSlug } from "../../src/repo-modules.mjs";
import { classifyFailureText, describeCause, pickCause } from "../../src/diagnose-lib.mjs";
import { laneForArgv, unreachableLanes } from "../../src/registry-preflight.mjs";
import { rescueSpecFor } from "../../src/playbook-lib.mjs";

/** 0026/D1 discipline: bound the per-repo location fan-out — recorded, never silent. */
const DEFAULT_MAX_LOCATIONS = 25;
/** A build is the same order of magnitude as an install (mvn package, tsc). */
const DEFAULT_TIMEOUT_MS = 600000;

/** Shell metacharacters that must never appear in a playbook argv token (D2 §2). */
const FORBIDDEN_TOKEN_CHARS = /[&|;<>`\n]/;

export const meta = {
  name: "commands.buildRun",
  category: "commands",
  summary:
    "Step-13 build stage: run the per-ecosystem build playbook at each integrated repo's install locations (guarded, bounded, argv-list, artifact-saving, exit-code honest); deterministic per-repo stub under mock.",
  params: {
    type: "object",
    required: ["integrated_from", "clones_from", "playbooks_dir", "into"],
    properties: {
      // Channel holding the integrated manifests ({ url, dir, modules, … }).
      integrated_from: { type: "string", minLength: 1 },
      // Channel holding the clone results — the clone-failed skip guard.
      clones_from: { type: "string", minLength: 1 },
      // Root of the ecosystem-build playbook tree, resolved against the
      // flow dir (0029/D1) — never a host-absolute path in yaml.
      playbooks_dir: { type: "string", minLength: 1 },
      // Channel the per-repo build results are written into.
      into: { type: "string", minLength: 1 },
      // Optional fingerprints channel — toolchain resolution via the registry's
      // detectToolchain (same recorded deviation as install-run.mjs).
      fingerprints_from: { type: "string" },
      // 0063/A2: optional channel holding the RUN-SCOPED registry preflight
      // (commands.registryPreflight). A step whose argv can cause an index
      // fetch (laneForArgv, 0063/A3) is skipped when its lane is dead —
      // `blocked`, never a red build the human blames on their own diff.
      preflight_from: { type: "string" },
      // Root for per-repo raw-output artifacts (0025/D1 discipline), resolved
      // against the flow dir. Default: ../../.harness/builds.
      save_dir: { type: "string" },
      // Cap the per-repo location fan-out; truncation is RECORDED (0025/A3).
      max_locations: { type: "integer", minimum: 1 },
      // Per-step subprocess timeout (platform rule 4).
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
 * 0063/D1 — the hermetic-toolchain assertion for a node location. A module
 * whose manifest declares dependencies must resolve its build tools from a
 * `node_modules` INSIDE the clone (per-location, or hoisted up to the clone
 * root — workspace layouts are legitimate). When none exists — the install was
 * skipped, failed, or never ran — npm's bin resolution would keep walking UP
 * the tree, and because the clones are materialized inside the harness's own
 * npm workspace it lands on the HARNESS's hoisted toolchain: `ts-baseline`
 * pins `typescript: 5.3.3`, the borrowed `tsc` is 6.0.3, and the "build
 * failure" is the harness's compiler rejecting the fixture's config. A green
 * build under a borrowed compiler would be even worse. Returns the blocking
 * reason, or null when the module may build. Fail-open on a missing/unreadable
 * manifest (no declared toolchain to assert) — the guard exists to stop the
 * silent borrow, not to invent a new failure mode.
 */
export async function nodeToolchainMissing(cwd, cloneRoot) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const declared = { ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) };
  if (Object.keys(declared).length === 0) return null;
  const root = resolve(cloneRoot ?? cwd);
  let dir = resolve(cwd);
  for (;;) {
    try {
      if ((await readdir(join(dir, "node_modules"))).length > 0) return null;
    } catch {
      // no node_modules at this level — keep walking, but never above the clone.
    }
    if (dir === root) break;
    const parent = dirname(dir);
    // stop at the fs root, or the moment the walk would leave the clone.
    if (parent === dir || !`${parent}${sep}`.startsWith(`${root}${sep}`)) break;
    dir = parent;
  }
  return "node_modules absent inside the clone — the manifest's declared dependencies (and their pinned toolchain) are not installed; refusing to resolve bins from an ancestor of the clone root (0063/D1)";
}

/**
 * Validate one playbook step (or a `fallback:`) against the D2 hard
 * constraints. Loud errors — a malformed playbook must never half-run.
 */
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
  if (typeof step.artifact !== "string" || step.artifact.length === 0) throw new Error(`${where}: 'artifact' is required`);
  if (step.allowNonZero !== true) throw new Error(`${where}: 'allowNonZero: true' is required on every step — the exit code is a RECORDED outcome (0025/A1)`);
  if (step.fallback !== undefined) validateStep(step.fallback, `${where}.fallback`);
}

/**
 * Load + validate one ecosystem's BUILD playbook yaml (0029/D1, same schema
 * as the 0026/D2 install playbooks; filename `build.yaml`). Parsed through the
 * vendored SDK loader's own YAML reader (`parseFlowConfig(...).raw`),
 * pre-env-interpolation so no `${…}` indirection can enter a playbook.
 */
export async function loadPlaybook(playbooksDir, ecosystem) {
  const path = join(playbooksDir, ecosystem, "build.yaml");
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
 * The single function that answers "what do I build for this location?" —
 * the same two-tier lookup as install (0026/D4): tier 1 (a repo-specific
 * build definition) is OUT OF SCOPE; tier 2 is the ecosystem playbook; no
 * playbook → the caller records `skipped: "no-playbook"`, never a silent
 * success. Tier 1, when it lands, may NEVER be LLM-detected evidence.
 */
export async function resolvePlaybook(location, { playbooksDir, cache }) {
  // tier 1: deferred — see 0026/D4.
  const ecosystem = location?.ecosystem;
  if (typeof ecosystem !== "string" || ecosystem.length === 0) return null;
  if (!cache.has(ecosystem)) cache.set(ecosystem, await loadPlaybook(playbooksDir, ecosystem));
  return cache.get(ecosystem);
}

/**
 * Whole-token placeholder substitution (D2 §3) — the ONLY values the atom
 * injects into a playbook, both fingerprint-derived repo-relative paths.
 */
function substituteToken(token, location) {
  if (token === "{{module.dir}}") return location.dir ?? ".";
  if (token === "{{module.manifest}}") return location.manifest ?? location.dir ?? ".";
  return token;
}

/** Test seam: build the factory over an injected argv runner + CLI probe. */
export function _buildRunWith({ runner = runArgv, probe = defaultProbe } = {}) {
  return function buildRunFactory(params, ctx) {
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
      // upstream (commands.registryPreflight via `preflight_from`) — the build
      // stage must never walk into the dead registry the install stage already
      // proved unreachable. The probe ran ONCE per flow; this stage only reads.
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

      const builds = [];
      const total = entries.length;
      let index = 0;
      for (const entry of entries) {
        // One bounded, idempotent progress tick per repo, BEFORE any branch —
        // the same `loop.guard` seam install-run.mjs / depgraph-extract.mjs
        // use, so the animated bar advances on every path (0011/0012).
        index += 1;
        ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });

        const url = typeof entry?.url === "string" ? entry.url : null;
        const dir = typeof entry?.dir === "string" && entry.dir.length > 0 ? entry.dir : null;
        const repo = dir ? basename(dir) : "unknown";
        const base = { placeholder: false, repo, url, dir, locations: [], steps: [], status: "skipped", failed: false };

        // Mock (default): pure state transform — no fs, subprocess, network, LLM.
        if (ctx.options.mock) {
          builds.push({ placeholder: true, repo, url, dir, locations: [], steps: [], status: "skipped" });
          continue;
        }

        // Skip guards, in order (0026/D1, mirroring install-run).
        const cloneError = typeof entry?.cloneError === "string" && entry.cloneError.length > 0
          ? entry.cloneError
          : (() => {
              const clone = url ? cloneByUrl.get(url) : null;
              return clone?.failed === true && typeof clone.errorClass === "string" ? clone.errorClass : null;
            })();
        if (cloneError) {
          builds.push({ ...base, skipped: "clone-failed", errorClass: cloneError });
          continue;
        }
        if (!dir || !(await exists(dir))) {
          builds.push({ ...base, skipped: "no-clone-dir" });
          continue;
        }

        const playbooksDir = isAbsolute(params.playbooks_dir) ? params.playbooks_dir : resolve(ctx.options.baseDir, params.playbooks_dir);
        const saveRel = params.save_dir ?? "../../.harness/builds";
        const saveRoot = isAbsolute(saveRel) ? saveRel : resolve(ctx.options.baseDir, saveRel);
        const artifactsDir = join(saveRoot, repo);

        const discovered = Array.isArray(entry?.modules) ? entry.modules.filter((m) => m && typeof m.dir === "string") : [];
        const locations = discovered.slice(0, maxLocations);
        const droppedLocations = discovered.slice(maxLocations).map((m) => m.dir);
        if (droppedLocations.length > 0) {
          // A truncated fan-out NAMES what it dropped (0025/A3's contract, reused).
          ctx.emit?.("loop.guard", { node: ctx.node?.id, count: locations.length, max: discovered.length, kind: "location-cap", dropped: droppedLocations });
        }

        if (locations.length === 0) {
          // No known build location → nothing to run, recorded (0026/D3 item 4).
          builds.push({ ...base, skipped: "no-playbook", ecosystem: entry?.ecosystem ?? null });
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
            // No playbook for the resolved ecosystem — NEVER a silent success.
            steps.push({ tool: null, location: location.dir, skipped: "no-playbook", ecosystem: location.ecosystem });
            continue;
          }
          const toolchainKeys = Object.keys(playbook.toolchains);
          if (toolchainKeys.length === 0) {
            // docker/other: an EXPLICIT no-op with a stated reason (D2 §5).
            steps.push({ tool: null, location: location.dir, skipped: "no-build-lane", ecosystem: location.ecosystem, reason: playbook.reason });
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

          // 0063/D1 — hermetic-toolchain guard: a node module with declared
          // dependencies but no node_modules inside the clone must be BLOCKED,
          // never allowed to borrow the harness's own hoisted toolchain by
          // ancestor bin resolution. Recorded, with the cause validate needs.
          let stepEnv;
          if (location.ecosystem === "node") {
            const missing = await nodeToolchainMissing(cwd, dir);
            if (missing) {
              steps.push({ tool: null, location: location.dir, skipped: "toolchain-not-installed", cause: "environment", reason: missing });
              continue;
            }
            // The module's own bins win: its node_modules/.bin leads the child's
            // PATH, so an installed tree always builds with the toolchain the
            // manifest pins, not whatever an ancestor happens to hoist.
            stepEnv = { PATH: `${join(cwd, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` };
          }

          for (const spec of playbook.toolchains[toolchain]) {
            // IF-CLI-present-ELSE-SKIP: primary guard, else fallback, else a
            // recorded skip — a missing toolchain is a result, not a crash.
            // 0063/A2 widens the gate exactly as install-run's 0054/A2 did: a
            // candidate whose argv can cause an index fetch ALSO requires its
            // registry lane to be alive — a dead lane is a recorded skip, and
            // BOTH gated candidates stay visible (D2 §4).
            const skips = [];
            let chosen = null;
            for (const candidate of [spec, spec.fallback]) {
              if (!candidate) continue;
              const dead = registrySkip(candidate, location);
              if (dead) {
                skips.push(dead);
                continue;
              }
              if (!(await probe(candidate.guard, cwd))) {
                skips.push({ tool: candidate.tool, location: location.dir, skipped: candidate.guard, reason: "not on PATH" });
                continue;
              }
              chosen = candidate;
              break;
            }
            steps.push(...skips);
            if (!chosen) continue;

            const ran = await runStep(chosen, { cwd, location, locationDir, runner, timeoutMs, env: stepEnv });
            steps.push(ran);

            // Primary build fails and a fallback exists: degrade, don't
            // guess — BOTH outcomes stay recorded (D2 §4). A fallback that
            // succeeds marks the primary `recovered` so the repo's status is
            // honest ("ok, via the degraded path") without erasing the failure.
            // The rescue honors the same registry gate (0063/A2): a rescue that
            // CANNOT work is not attempted — and saying so is a record.
            if (ran.ok === false && chosen === spec && spec.fallback) {
              const unrunnable = registrySkip(spec.fallback, location);
              if (unrunnable) {
                steps.push(unrunnable);
              } else if (await probe(spec.fallback.guard, cwd)) {
                // 0066/D1: the rescue writes to a `.fallback`-suffixed artifact
                // when the fallback rung declares the primary's own artifact
                // name (both python-build rungs say `python-build.log`) — else
                // the rescue's success log overwrites the primary's failure log
                // and the evidence is destroyed exactly when it starts to matter.
                const rescue = await runStep(rescueSpecFor(spec), { cwd, location, locationDir, runner, timeoutMs, env: stepEnv });
                steps.push(rescue);
                if (rescue.ok) ran.recovered = true;
              }
            }
          }
        }

        // 0026/A3 (reaffirmed by 0029/D1): the LLM's build evidence is
        // compared, never executed. A divergence is an INFORMATIONAL finding —
        // the model keeps its advisory role and loses its authority.
        const llmBuild = Array.isArray(entry?.build) ? entry.build.filter((c) => typeof c === "string" && c.length > 0) : [];
        if (llmBuild.length > 0) {
          const executed = new Set(steps.filter((s) => Array.isArray(s.argv)).map((s) => s.argv.join(" ")));
          const divergent = llmBuild.filter((cmd) => !executed.has(cmd));
          if (divergent.length > 0) {
            findings.push({
              severity: "info",
              note: `llm-detected build evidence diverges from the executed playbook (evidence only, never run — 0026/A3): ${divergent.join(" · ")}`,
            });
          }
        }

        const executedSteps = steps.filter((s) => typeof s.exitCode === "number");
        const failed = executedSteps.some((s) => s.exitCode !== 0 && !s.recovered);
        // 0063/A1 discipline (applied to this stage by A2/D1): a step skipped by
        // a GUARD — dead registry lane, uninstalled toolchain — invalidates the
        // stage verdict. The repo is never `ok` on the strength of the steps the
        // guard let through, and the record carries the cause so validate scores
        // it `blocked` on a named environmental cause, never a build failure.
        const blocking = failed ? null : steps.find((s) => s.skipped === "registry-unreachable" || s.skipped === "toolchain-not-installed");
        const status = executedSteps.length === 0 || blocking ? "skipped" : failed ? "failed" : "ok";
        const result = { ...base, locations: usedLocations, steps, findings, status, failed, artifactsDir };
        if (blocking) {
          result.skipped = blocking.skipped;
          result.cause = blocking.cause;
        }
        // The dominant cause across the failing (non-recovered) steps — validate
        // consumes it to tell a pre-existing/toolchain break from a regression.
        const buildCause = failed ? pickCause(executedSteps.filter((s) => s.ok === false && !s.recovered).map((s) => s.cause)) : null;
        if (buildCause !== null) {
          result.cause = buildCause;
          result.causeDescription = describeCause(buildCause);
        }
        if (droppedLocations.length > 0) result.locationsTruncated = { max: maxLocations, discovered: discovered.length, dropped: droppedLocations };
        builds.push(result);
      }
      return { [params.into]: builds };
    };
  };
}

/**
 * Run one playbook step: argv-list, bounded, artifact-saving, exit-code honest.
 * `env` (0063/D1) carries the hermetic PATH for node locations — the module's
 * own `node_modules/.bin` first — merged over the inherited env by the runner.
 */
async function runStep(spec, { cwd, location, locationDir, runner, timeoutMs, env }) {
  const argv = spec.argv.map((token) => substituteToken(token, location));
  const { stdout, stderr, exitCode } = await runner(argv, { cwd, timeoutMs, allowNonZero: true, env });
  const artifact = join(locationDir, spec.artifact);
  await writeFile(artifact, stdout ?? "", "utf8");
  const record = { tool: spec.tool, location: location.dir, argv, artifact, exitCode, ok: exitCode === 0 };
  if (typeof stderr === "string" && stderr.length > 0) {
    record.stderrArtifact = `${artifact}.stderr.txt`;
    await writeFile(record.stderrArtifact, stderr, "utf8");
  }
  // Diagnose a FAILED build (capability 9) over the output already in memory —
  // `tsc` writes its TS5107 toolchain deprecation to STDOUT, network errors to
  // stderr, so classify both. Benign causes (toolchain / environment) let
  // validate mark the repo `blocked`, not a remediation regression.
  if (exitCode !== 0) {
    const cause = classifyFailureText(`${stdout ?? ""}\n${stderr ?? ""}`);
    if (cause !== null) record.cause = cause;
  }
  return record;
}

export const buildRun = _buildRunWith({});
