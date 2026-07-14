/**
 * commands.installRun — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the step-10 `install`
 * stage (change record 0026/D1) — loop over the integrated repos, resolve each
 * repo's install locations (`integrated[].modules`, ecosystem-tagged per
 * 0026/A2), and run the matching declarative ecosystem-installation playbook
 * (`configs/playbooks/ecosystem-installation/<ecosystem>/install.yaml`,
 * 0026/D2) at each location. Modeled squarely on `commands.depgraphExtract` —
 * the pack's proven template for guarded, bounded, argv-list, artifact-saving,
 * exit-code-honest per-repo execution.
 *
 * AUTHORITY BOUNDARY (0026/A3): `integrated[].install` — the LLM's shell
 * strings detected over untrusted repo excerpts — is EVIDENCE, never an
 * execution plan. This atom NEVER executes it: `"cd repo-a && npm install"`
 * cannot be an argv list (security rule §4), and executing model output
 * conditioned on cloned repo content would turn DATA into instructions
 * (security rules §1/§2). Execution comes exclusively from the repo-authored,
 * reviewed, argv-list playbooks, selected by the fingerprint-derived
 * `modules[].ecosystem`; a divergence between the LLM's evidence and the
 * playbook's argv is recorded as an INFORMATIONAL finding on the result.
 * Do not "simplify" this atom by piping `integrated[].install` into a shell.
 *
 * FALLBACK TIER (0026/D4): installation resolution is a two-tier lookup with a
 * documented precedence, of which only tier 2 is implemented — see
 * `resolvePlaybook`. Tier 1 (a repo-specific installation definition) is OUT
 * OF SCOPE; when it lands it overrides (never merges with) the playbook, and
 * it may never be `integrated[].install`.
 *
 * Real-vs-mock contract (platform rule 3 + security rule §8): under `--mock`
 * (default) the atom is a pure state transform returning one deterministic
 * `{ placeholder: true, repo, url, dir, locations: [], steps: [],
 * status: "skipped" }` stub per integrated entry — no fs, no subprocess, no
 * network, no LLM. `npm ci` / `pip install` / `mvn install` all need network,
 * so real installs run only outside the default verify gate.
 *
 * Exit-code honesty (0025/A1, non-negotiable): every playbook step carries
 * `allowNonZero: true` — the atom never throws — and each step record carries
 * `{ tool, location, argv, artifact, exitCode, ok }`; the per-repo result
 * carries `status` ("ok" | "failed" | "skipped") + `failed`. A BUILD FAILURE
 * never presents as a clean install. Raw stdout goes to
 * `<save_dir>/<repo>/[<location-slug>/]<artifact>`, with a
 * `<artifact>.stderr.txt` sibling when stderr is non-empty (0025/D1).
 *
 * Toolchain note (recorded deviation from 0026/D1's param list): playbook
 * `toolchains:` are keyed by `detectToolchain()`, which reads the FINGERPRINT
 * (buildTools / packageManagers) — a signal `integrated[]` entries do not
 * carry. The atom therefore takes an OPTIONAL `fingerprints_from` channel and
 * resolves the toolchain through the registry seam (never a private
 * basename-sniffing table — the drift 0019/A4 ended); absent a resolvable
 * toolchain it uses the playbook's `default:` key, else records a skip.
 *
 * FAIL FAST, DON'T PAY THE TOLL (0054). Three seams keep a dead registry from
 * costing 19 minutes of retry-backoff sleep — the measured cost of session
 * c87d0310, where Docker was down, every `npm` command slept 70 s and then
 * silently fell back to cache, and the run still exited 0:
 *   · D1 — `src/registry-preflight.mjs` probes the CONFIGURED endpoints ONCE,
 *     before the first step, for the lanes actually in play. Unreachable ⇒
 *     A2's widened guard skips the registry-touching steps up front
 *     (`skipped: "registry-unreachable"`, cause `environment` ⇒ `blocked`,
 *     never `broken`). It NEVER reroutes to a public registry. 0063/A2 made
 *     the probe a RUN-SCOPED fact: `commands.registryPreflight` computes it
 *     and this stage consumes it via `preflight_from` (the inline probe stays
 *     as the fallback for a bare, unwired stage) — and 0063/A1 made a
 *     guard-skipped step STAGE-INVALIDATING: the repo verdict is never `ok`
 *     on the strength of the ungated steps alone.
 *   · A3 — `runStep` injects a bounded retry budget into registry-touching
 *     children, so a registry that dies MID-run costs ~1 s per command, not 70.
 *   · D2 — a per-cause circuit breaker short-circuits the stage after N
 *     consecutive identical faults (see `createCauseBreaker`).
 * And A1 removes the serialization multiplier itself: repos install under a
 * BOUNDED concurrency pool (`concurrency`, default 4) instead of a serial
 * `for…of`, which pays off in the healthy case too. `installs` stays
 * input-ordered and the progress tick is a completion counter — three
 * downstream consumers and the C1 contract read that channel positionally.
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
import { classifyFailureText, createCauseBreaker } from "../../src/diagnose-lib.mjs";
import { rescueSpecFor } from "../../src/playbook-lib.mjs";
import {
  DEFAULT_FETCH_RETRIES,
  DEFAULT_FETCH_RETRY_MAX_MS,
  laneForArgv,
  lanesForEcosystems,
  preflightMessage,
  registryPreflight,
  retryEnvForLane,
  unreachableLanes,
} from "../../src/registry-preflight.mjs";

/** 0026/D1: bound the per-repo location fan-out — recorded, never silent. */
const DEFAULT_MAX_LOCATIONS = 25;
/** An install is an order of magnitude slower than step 11's 120s commands. */
const DEFAULT_TIMEOUT_MS = 600000;
/** 0054/A1: repos are independent (each installs into its own clone) — overlap them, BOUNDED. */
const DEFAULT_CONCURRENCY = 4;
/** 0054/D2: consecutive same-cause step failures that trip the breaker. */
const DEFAULT_FAIL_FAST_AFTER = 3;

/** Shell metacharacters that must never appear in a playbook argv token (D2 §2). */
const FORBIDDEN_TOKEN_CHARS = /[&|;<>`\n]/;

export const meta = {
  name: "commands.installRun",
  category: "commands",
  summary:
    "Step-10 install stage: run the per-ecosystem installation playbook at each integrated repo's install locations (guarded, bounded, argv-list, artifact-saving, exit-code honest); deterministic per-repo stub under mock.",
  params: {
    type: "object",
    required: ["integrated_from", "clones_from", "playbooks_dir", "into"],
    properties: {
      // Channel holding the integrated manifests ({ url, dir, modules, install… }).
      integrated_from: { type: "string", minLength: 1 },
      // Channel holding the clone results — the clone-failed skip guard.
      clones_from: { type: "string", minLength: 1 },
      // Root of the ecosystem-installation playbook tree, resolved against the
      // flow dir (0026/D2) — never a host-absolute path in yaml.
      playbooks_dir: { type: "string", minLength: 1 },
      // Channel the per-repo install results are written into.
      into: { type: "string", minLength: 1 },
      // Optional fingerprints channel — toolchain resolution via the registry's
      // detectToolchain (recorded deviation, see module docstring).
      fingerprints_from: { type: "string" },
      // 0063/A2: optional channel holding the RUN-SCOPED registry preflight
      // (commands.registryPreflight). When present the stage consumes that
      // fact instead of re-probing; absent, the 0054/D1 inline probe remains
      // the fallback so a bare stage still guards itself.
      preflight_from: { type: "string" },
      // Root for per-repo raw-output artifacts (0025/D1 discipline), resolved
      // against the flow dir. Default: ../../.harness/installs.
      save_dir: { type: "string" },
      // Cap the per-repo location fan-out; truncation is RECORDED (0025/A3).
      max_locations: { type: "integer", minimum: 1 },
      // Per-step subprocess timeout (platform rule 4).
      timeout_ms: { type: "integer", minimum: 1 },
      // 0054/A1: how many repos install CONCURRENTLY. A real bound, never an
      // unbounded Promise.all (platform rule 4). `1` restores the serial walk.
      concurrency: { type: "integer", minimum: 1 },
      // 0054/D2: consecutive same-cause step failures that trip the breaker.
      // `0` disables it (deliberate soak runs).
      fail_fast_after: { type: "integer", minimum: 0 },
      // 0054/A3: the bounded retry budget injected into registry-touching
      // children. A CAP ON RETRY TIMING — never a registry reroute.
      fetch_retries: { type: "integer", minimum: 0 },
      fetch_retry_max_ms: { type: "integer", minimum: 1 },
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
  if (step.requires_file !== undefined) {
    // Optional file gate (npm ci ⇒ package-lock.json). Existence-checked only,
    // never executed — but held to the trust boundary anyway: a location-relative
    // path that cannot escape the install location.
    if (typeof step.requires_file !== "string" || step.requires_file.length === 0) {
      throw new Error(`${where}: 'requires_file' must be a non-empty string when present`);
    }
    if (isAbsolute(step.requires_file) || step.requires_file.split(/[\\/]/).includes("..")) {
      throw new Error(`${where}: 'requires_file' must be a location-relative path with no '..' escapes (trust boundary)`);
    }
  }
  if (typeof step.artifact !== "string" || step.artifact.length === 0) throw new Error(`${where}: 'artifact' is required`);
  if (step.allowNonZero !== true) throw new Error(`${where}: 'allowNonZero: true' is required on every step — the exit code is a RECORDED outcome (0025/A1)`);
  if (step.fallback !== undefined) validateStep(step.fallback, `${where}.fallback`);
}

/**
 * Load + validate one ecosystem's playbook yaml (0026/D2). Parsed through the
 * vendored SDK loader's own YAML reader (`parseFlowConfig(...).raw` — the
 * pack resolves no yaml package of its own; the same reuse 0022 established),
 * pre-env-interpolation so no `${…}` indirection can enter a playbook.
 */
export async function loadPlaybook(playbooksDir, ecosystem) {
  const path = join(playbooksDir, ecosystem, "install.yaml");
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
 * 0026/D4 — the single function that answers "what do I run for this
 * location?". A two-tier lookup with a documented precedence:
 *
 *   tier 1 — a repo-specific installation definition: OUT OF SCOPE (deferred).
 *   tier 2 — the ecosystem playbook (0026/D2).
 *   —      — no playbook for the ecosystem: the caller records
 *            `skipped: "no-playbook"`, never a silent success.
 *
 * Tier 1 is never present today, so every location falls through to its
 * ecosystem playbook. When tier 1 lands it slots in ABOVE the playbook
 * (override, not merge), must be a repo-authored argv-list definition
 * validated against the same D2 schema, and may NEVER be
 * `integrated[].install` (0026/A3 forecloses executing LLM shell strings).
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

/** Test seam: build the factory over an injected argv runner + CLI probe + preflight. */
export function _installRunWith({ runner = runArgv, probe = defaultProbe, preflight = registryPreflight } = {}) {
  return function installRunFactory(params, ctx) {
    return async (state) => {
      const entries = Array.isArray(state[params.integrated_from]) ? state[params.integrated_from] : [];
      const clones = Array.isArray(state[params.clones_from]) ? state[params.clones_from] : [];
      const fingerprints = params.fingerprints_from && Array.isArray(state[params.fingerprints_from]) ? state[params.fingerprints_from] : [];
      const cloneByUrl = new Map(clones.filter((c) => typeof c?.url === "string").map((c) => [c.url, c]));
      const fpByUrl = new Map(fingerprints.filter((f) => typeof f?.url === "string").map((f) => [f.url, f]));

      const timeoutMs = Number.isInteger(params.timeout_ms) && params.timeout_ms > 0 ? params.timeout_ms : DEFAULT_TIMEOUT_MS;
      const maxLocations = Number.isInteger(params.max_locations) && params.max_locations > 0 ? params.max_locations : DEFAULT_MAX_LOCATIONS;
      const concurrency = Number.isInteger(params.concurrency) && params.concurrency > 0 ? params.concurrency : DEFAULT_CONCURRENCY;
      const failFastAfter = Number.isInteger(params.fail_fast_after) && params.fail_fast_after >= 0 ? params.fail_fast_after : DEFAULT_FAIL_FAST_AFTER;
      const retryBudget = {
        retries: Number.isInteger(params.fetch_retries) && params.fetch_retries >= 0 ? params.fetch_retries : DEFAULT_FETCH_RETRIES,
        maxTimeoutMs: Number.isInteger(params.fetch_retry_max_ms) && params.fetch_retry_max_ms > 0 ? params.fetch_retry_max_ms : DEFAULT_FETCH_RETRY_MAX_MS,
      };
      const playbookCache = new Map();

      // 0054/D2: one breaker for the whole stage — per-cause, resets on success.
      const breaker = createCauseBreaker({ threshold: failFastAfter });
      const openBreaker = (ran) => {
        const opened = breaker.observe(ran);
        if (opened) {
          ctx.emit?.("loop.guard", { node: ctx.node?.id, kind: "circuit-open", cause: opened, after: failFastAfter, message: `install: ${failFastAfter} consecutive '${opened}' failures — short-circuiting the remaining steps (0054/D2)` });
        }
      };

      // 0054/D1 → 0063/A2: the registry preflight is a RUN-SCOPED fact. When
      // the flow wires `preflight_from` (commands.registryPreflight probed the
      // lanes once, upstream), consume that channel; else fall back to the
      // 0054/D1 inline probe so a bare stage still guards itself. Skipped
      // ENTIRELY under mock (no fs, no subprocess, no network — platform rule 3
      // / security rule §8). On failure we do NOT reroute to a public registry:
      // the local registry is load-bearing.
      let preflightResult = null;
      let deadLanes = new Set();
      if (!ctx.options.mock) {
        const shared = params.preflight_from ? state[params.preflight_from] : null;
        if (shared && shared.placeholder !== true && Array.isArray(shared.checked)) {
          preflightResult = shared;
          deadLanes = unreachableLanes(preflightResult);
        } else {
          const ecosystems = entries.flatMap((e) => (Array.isArray(e?.modules) ? e.modules.map((m) => m?.ecosystem) : []));
          const lanes = lanesForEcosystems(ecosystems);
          if (lanes.length > 0) {
            preflightResult = await preflight({ lanes, runner });
            deadLanes = unreachableLanes(preflightResult);
            if (!preflightResult.ok) {
              ctx.emit?.("loop.guard", { node: ctx.node?.id, kind: "registry-preflight", lanes: [...deadLanes], message: preflightMessage(preflightResult) });
            }
          }
        }
      }
      const laneStatus = new Map((preflightResult?.checked ?? []).map((c) => [c.lane, c]));
      /** A2: the widened guard — "can the tool do its job?", not just "is it installed?". */
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

      const total = entries.length;
      // 0054/A1: results are written BY INDEX, never pushed on settle — the
      // `installs` channel stays INPUT-ORDERED for install_verify, validate,
      // the decision log and the C1 contract, all of which read it positionally.
      const installs = new Array(total);
      let done = 0;

      const installOne = async (entry) => {
        const url = typeof entry?.url === "string" ? entry.url : null;
        const dir = typeof entry?.dir === "string" && entry.dir.length > 0 ? entry.dir : null;
        const repo = dir ? basename(dir) : "unknown";
        const base = { placeholder: false, repo, url, dir, locations: [], steps: [], status: "skipped", failed: false };

        // Mock (default): pure state transform — no fs, subprocess, network, LLM.
        if (ctx.options.mock) {
          return { placeholder: true, repo, url, dir, locations: [], steps: [], status: "skipped" };
        }

        // Skip guards, in order (0026/D1, mirroring depgraph-extract).
        const cloneError = typeof entry?.cloneError === "string" && entry.cloneError.length > 0
          ? entry.cloneError
          : (() => {
              const clone = url ? cloneByUrl.get(url) : null;
              return clone?.failed === true && typeof clone.errorClass === "string" ? clone.errorClass : null;
            })();
        if (cloneError) return { ...base, skipped: "clone-failed", errorClass: cloneError };
        if (!dir || !(await exists(dir))) return { ...base, skipped: "no-clone-dir" };

        // 0054/D2: the breaker is already open — this repo never runs a step.
        // `blocked` (the cause is benign), never `broken`, and never silent.
        if (breaker.open) return { ...base, skipped: "circuit-open", cause: breaker.open };

        const playbooksDir = isAbsolute(params.playbooks_dir) ? params.playbooks_dir : resolve(ctx.options.baseDir, params.playbooks_dir);
        const saveRel = params.save_dir ?? "../../.harness/installs";
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
          // 0026/D3 item 4: no known install location → nothing to run, recorded.
          return { ...base, skipped: "no-playbook", ecosystem: entry?.ecosystem ?? null };
        }

        const fp = url ? fpByUrl.get(url)?.fingerprint ?? null : null;
        const steps = [];
        const findings = [];
        const usedLocations = [];

        for (const location of locations) {
          usedLocations.push(location);
          if (breaker.open) {
            steps.push({ tool: null, location: location.dir, skipped: "circuit-open", cause: breaker.open });
            continue;
          }
          const playbook = await resolvePlaybook(location, { playbooksDir, cache: playbookCache });
          if (!playbook) {
            // No playbook for the resolved ecosystem — NEVER a silent success.
            steps.push({ tool: null, location: location.dir, skipped: "no-playbook", ecosystem: location.ecosystem });
            continue;
          }
          const toolchainKeys = Object.keys(playbook.toolchains);
          if (toolchainKeys.length === 0) {
            // docker/other: an EXPLICIT no-op with a stated reason (D2 §5).
            steps.push({ tool: null, location: location.dir, skipped: "no-install-lane", ecosystem: location.ecosystem, reason: playbook.reason });
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
            // 0054/D2: a tripped breaker short-circuits every remaining step
            // WITHOUT executing it — recorded, carrying the tripping cause.
            if (breaker.open) {
              steps.push({ tool: spec.tool, location: location.dir, skipped: "circuit-open", cause: breaker.open });
              continue;
            }

            // IF-CLI-present-ELSE-SKIP: primary guard, else fallback, else a
            // recorded skip — a missing toolchain is a result, not a crash.
            // A step may also gate on `requires_file` (npm ci ⇒
            // package-lock.json): when that file is absent at the location the
            // step is bypassed UP FRONT — a recorded skip, never a doomed run —
            // and selection degrades to the fallback (`npm install`), exactly
            // like a failed guard probe. Every bypass stays visible (D2 §4).
            //
            // 0054/A2 widens exactly this gate: `npm` being on PATH says nothing
            // about `http://localhost:4873` answering, so a step whose argv
            // reaches a registry ALSO requires that registry to be reachable
            // (the D1 preflight, evaluated once per flow and cached — never
            // per step, which would reintroduce the cost being removed).
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
              if (candidate.requires_file && !(await exists(resolve(cwd, candidate.requires_file)))) {
                skips.push({ tool: candidate.tool, location: location.dir, skipped: candidate.requires_file, reason: "required file absent" });
                continue;
              }
              chosen = candidate;
              break;
            }
            steps.push(...skips);
            if (!chosen) continue;

            const ran = await runStep(chosen, { cwd, location, locationDir, runner, timeoutMs, retryBudget });
            steps.push(ran);
            openBreaker(ran);

            // `npm ci` that fails AT RUNTIME (e.g. lockfile drift — present but
            // out of sync): degrade to the fallback, don't guess — BOTH outcomes
            // stay recorded (D2 §4). A fallback that succeeds marks the primary
            // `recovered` so the repo's status is honest ("ok, via the degraded
            // path") without erasing the failure. The rescue honors the same
            // guard + requires_file gates as first-pass selection — plus the
            // registry gate (0054/A2) and the breaker (0054/D2): a rescue that
            // CANNOT work is not attempted, and — absent ≠ skipped (0051/A3) —
            // saying so is a RECORD, never a silent omission.
            if (ran.ok === false && chosen === spec && spec.fallback) {
              const fallback = spec.fallback;
              const unrunnable = breaker.open
                ? { tool: fallback.tool, location: location.dir, skipped: "circuit-open", cause: breaker.open }
                : registrySkip(fallback, location);
              if (unrunnable) {
                steps.push(unrunnable);
              } else if (await probe(fallback.guard, cwd)) {
                if (!(fallback.requires_file && !(await exists(resolve(cwd, fallback.requires_file))))) {
                  // 0066/D1: de-collide the rescue's artifact — the python rungs
                  // share `venv-create.log`/`pip-install.log` with their primary,
                  // so an un-suffixed rescue destroys the primary's failure log.
                  // npm-ci → npm-install already declares its own artifact and is
                  // left byte-unchanged.
                  const rescue = await runStep(rescueSpecFor(spec), { cwd, location, locationDir, runner, timeoutMs, retryBudget });
                  steps.push(rescue);
                  openBreaker(rescue);
                  if (rescue.ok) ran.recovered = true;
                }
              }
            }
          }
        }

        // 0026/A3: the LLM's install evidence is compared, never executed. A
        // divergence is an INFORMATIONAL finding — the model keeps its
        // advisory role and loses its (never-exercised) authority.
        const llmInstall = Array.isArray(entry?.install) ? entry.install.filter((c) => typeof c === "string" && c.length > 0) : [];
        if (llmInstall.length > 0) {
          const executed = new Set(steps.filter((s) => Array.isArray(s.argv)).map((s) => s.argv.join(" ")));
          const divergent = llmInstall.filter((cmd) => !executed.has(cmd));
          if (divergent.length > 0) {
            findings.push({
              severity: "info",
              note: `llm-detected install evidence diverges from the executed playbook (evidence only, never run — 0026/A3): ${divergent.join(" · ")}`,
            });
          }
        }

        const executedSteps = steps.filter((s) => typeof s.exitCode === "number");
        const failed = executedSteps.some((s) => s.exitCode !== 0 && !s.recovered);
        // 0063/A1: a step SKIPPED BY A GUARD (registry unreachable, breaker
        // open) invalidates the stage — the verdict must account for steps that
        // were skipped, not only steps that ran. The python playbook is the
        // proof: `python3 -m venv` (correctly ungated) exits 0 while the gated
        // `pip install` is skipped — nothing that touched the registry ran, yet
        // the stage reported `ok` on the strength of a 0-byte venv-create.log.
        // That is 0034/A1's silent false positive arriving through a new door,
        // and it is worse than a red build: it tells build-run the environment
        // is sound. `ok` now requires every declared step to have run and
        // succeeded, or to have been skipped for a BENIGN reason (missing
        // lockfile, tool not on PATH); a guard-skip is stage-invalidating.
        const blocking = failed ? null : steps.find((s) => s.skipped === "registry-unreachable" || s.skipped === "circuit-open");
        const status = executedSteps.length === 0 || blocking ? "skipped" : failed ? "failed" : "ok";
        const result = { ...base, locations: usedLocations, steps, findings, status, failed, artifactsDir };
        if (droppedLocations.length > 0) result.locationsTruncated = { max: maxLocations, discovered: discovered.length, dropped: droppedLocations };
        // The repo record carries the guard's cause — so install-verify records a
        // vacuous skip that NAMES it and validate scores the repo `blocked` on an
        // environmental cause, never `broken` and never a false `ok` (0054/D1 §4,
        // 0033/0035 verdict discipline, 0051/A3 "absent ≠ skipped").
        if (blocking) {
          result.skipped = blocking.skipped;
          result.cause = blocking.cause;
        }
        return result;
      };

      // 0054/A1: repos install CONCURRENTLY under a bounded pool — each installs
      // into its own clone dir, so they are independent by construction. Per-repo
      // locations and steps stay ORDERED (a playbook's steps are sequenced by
      // design: `npm ci` → fallback `npm install`). `concurrency: 1` restores the
      // serial walk. A bounded pool, never an unbounded Promise.all over N repos
      // (platform rule 4).
      let next = 0;
      const worker = async () => {
        for (;;) {
          const i = next;
          next += 1;
          if (i >= total) return;
          installs[i] = await installOne(entries[i]);
          // The progress tick is a COMPLETION counter, not a loop index: under a
          // pool, completions arrive out of order and an index-based tick would
          // report nonsense (0054/A1). Same bounded `loop.guard` seam as before.
          done += 1;
          ctx.emit?.("loop.guard", { node: ctx.node?.id, count: done, max: total, kind: "stage" });
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, () => worker()));
      return { [params.into]: installs };
    };
  };
}

/**
 * Run one playbook step: argv-list, bounded, artifact-saving, exit-code honest.
 *
 * 0054/A3: registry-touching children are spawned with a BOUNDED retry budget
 * (npm's ambient policy is 10 s + 60 s of pure sleep before it silently falls
 * back to cache). This is a cap on retry TIMING only — it never rewrites
 * `registry` / `index-url`, and no code path here reroutes to a public registry.
 * 0054/D2: a failing step is classified through the EXISTING diagnose-lib
 * taxonomy so the breaker counts causes, not strings.
 */
async function runStep(spec, { cwd, location, locationDir, runner, timeoutMs, retryBudget }) {
  const argv = spec.argv.map((token) => substituteToken(token, location));
  const env = retryEnvForLane(laneForArgv(argv), retryBudget);
  const { stdout, stderr, exitCode } = await runner(argv, { cwd, timeoutMs, allowNonZero: true, env });
  const artifact = join(locationDir, spec.artifact);
  await writeFile(artifact, stdout ?? "", "utf8");
  const record = { tool: spec.tool, location: location.dir, argv, artifact, exitCode, ok: exitCode === 0 };
  if (typeof stderr === "string" && stderr.length > 0) {
    record.stderrArtifact = `${artifact}.stderr.txt`;
    await writeFile(record.stderrArtifact, stderr, "utf8");
  }
  if (record.ok === false) {
    const cause = classifyFailureText(`${stdout ?? ""}\n${stderr ?? ""}`);
    if (cause) record.cause = cause;
  }
  return record;
}

export const installRun = _installRunWith({});
