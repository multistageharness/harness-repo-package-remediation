/**
 * src/registry-preflight.mjs — fail-fast package-registry reachability probe
 * (change record 0054/D1), plus the lane table A2's guard and A3's retry cap
 * are keyed by.
 *
 * WHY THIS EXISTS. Session c87d0310 spent 19 of its 22 minutes asleep: Docker
 * was down, so Verdaccio (`:4873`) and devpi (`:3141`) refused every connection
 * and each `npm` command paid npm's own retry policy — `fetch-retries=2`,
 * `fetch-retry-mintimeout=10000`, factor 10, capped at 60 s → 70 s of pure
 * sleep — before silently falling back to its cache and exiting 0. The run
 * "succeeded", which is exactly why nobody saw it. `src/diagnose-lib.mjs`
 * already recognizes this failure (its `ENVIRONMENT_PATTERNS` match
 * `ECONNREFUSED` and both localhost endpoints by name) — but only FORENSICALLY,
 * after the 19 minutes are spent. This module moves that same knowledge
 * UPSTREAM of the cost: one ~0.1 s connect, once per flow, before the first
 * install step.
 *
 * NON-NEGOTIABLE — NEVER REROUTE (0054/D1 note; root CLAUDE.md). On an
 * unreachable registry this module fails fast and says so. It does NOT
 * "helpfully" fall back to `registry.npmjs.org` / `pypi.org`. The local
 * registries are intentional AND load-bearing: `multi-repo-npm` depends on
 * `@harness/core`, a scoped package that exists ONLY in the local Verdaccio. A
 * public-registry fallback could not serve it — it would trade a fast, honest,
 * correctly-diagnosed failure for a slow, confusing, WRONG one. Surfacing the
 * Docker state IS the feature. Do not "improve" this by adding a fallback.
 *
 * CONFIGURED, NEVER HARD-CODED. The endpoints are read from the package
 * managers themselves (`npm config get registry`, `pip config get
 * global.index-url`), so a CI box on the public registry probes the public
 * registry and is correctly reported healthy — not falsely blocked. Only the
 * lanes actually in play are probed: a maven-only run is never blocked by a
 * dead devpi.
 *
 * Purity: no clock, no fs, no shell strings — the argv runner and `fetch` are
 * injected seams (tests stay fully offline), and every subprocess is an argv
 * list (security rule §4).
 */

import { tmpdir } from "node:os";
import { basename } from "node:path";

/** A refused TCP connect answers in ~0.1 s; 1 s is a generous ceiling for a probe. */
export const DEFAULT_PROBE_TIMEOUT_MS = 1000;

/** 0054/A3 — the bounded retry budget injected into registry-touching children. */
export const DEFAULT_FETCH_RETRIES = 1;
export const DEFAULT_FETCH_RETRY_MAX_MS = 5000;

/** Which registry lane an ecosystem resolves through — the lanes worth probing. */
export const LANE_BY_ECOSYSTEM = { node: "npm", python: "pip" };

/** Lane fronts. A bin not listed here resolves through no CONFIGURED endpoint. */
const NPM_BINS = new Set(["npm", "npx", "pnpm", "yarn"]);
const PIP_BINS = new Set(["pip", "pip3", "uv", "poetry"]);
/**
 * 0063/A3 — TRANSITIVE index consumers: commands that are not package managers
 * but BOOTSTRAP an isolated environment from the index. `python -m build` (and
 * its standalone `pyproject-build` front) is the canonical case: PEP 517 makes
 * it create its own build env and pip-install `build-system.requires` from the
 * configured index — one child process deep, invisible to a bin-name test, and
 * the exact failure that turned a dead devpi into a "red build" (session
 * f9f30203). The question this table answers is "can this command CAUSE an
 * index fetch?", never "is this command a package manager?".
 */
const TRANSITIVE_INDEX_BINS = new Map([
  ["build", "pip"],
  ["pyproject-build", "pip"],
]);
/** `python -m <module>` modules that reach the index (directly or transitively). */
const PYTHON_INDEX_MODULES = new Set(["pip", "build"]);

const DEFAULT_ENDPOINT = { npm: "https://registry.npmjs.org/", pip: "https://pypi.org/simple/" };

/** Argv candidates that ASK the package manager where its registry is. */
const ENDPOINT_ARGV = {
  npm: [["npm", "config", "get", "registry"]],
  pip: [
    ["pip", "config", "get", "global.index-url"],
    ["pip3", "config", "get", "global.index-url"],
    ["python3", "-m", "pip", "config", "get", "global.index-url"],
  ],
};

/** Env overrides the package managers honor, consulted when the CLI says nothing. */
const ENDPOINT_ENV = { npm: ["npm_config_registry", "NPM_CONFIG_REGISTRY"], pip: ["PIP_INDEX_URL"] };

const binName = (token) => basename(String(token ?? "")).replace(/\.(exe|cmd|bat)$/i, "");

/**
 * Which registry lane does this argv reach out to — or null when it touches no
 * configured registry at all? This is the seam that keeps A2's guard honest:
 * `python3 -m venv .venv` creates a venv WITHOUT the index (null → always runs),
 * while `.venv/bin/pip install -r requirements.txt` does (pip → gated).
 *
 * 0063/A3 — the question is "can this command CAUSE an index fetch?", not "is
 * this command a package manager?". A TRANSITIVE consumer counts: `python -m
 * build` never talks to the index itself — it spawns a child (PEP 517 isolated
 * build env) that does, which looks identical to the correctly-ungated
 * `python -m venv` under a bin-name test and is its exact opposite. Anyone
 * adding a build front-end here inherits that question, not the bin table.
 * @param {string[]} argv
 * @returns {"npm"|"pip"|null}
 */
export function laneForArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || typeof argv[0] !== "string") return null;
  const bin = binName(argv[0]);
  if (NPM_BINS.has(bin)) return "npm";
  if (PIP_BINS.has(bin)) return "pip";
  // PEP-517 fronts et al. — transitive index consumers (0063/A3).
  if (TRANSITIVE_INDEX_BINS.has(bin)) return TRANSITIVE_INDEX_BINS.get(bin);
  // `python -m pip install …` / `python -m build` — the interpreter fronting
  // for a direct (pip) or transitive (build) index consumer.
  if (/^python[\d.]*$/.test(bin) && argv[1] === "-m" && PYTHON_INDEX_MODULES.has(argv[2])) return "pip";
  return null;
}

/** The lanes in play for a set of ecosystems — never probe a lane nobody uses. */
export function lanesForEcosystems(ecosystems) {
  const lanes = new Set();
  for (const eco of Array.isArray(ecosystems) ? ecosystems : []) {
    const lane = LANE_BY_ECOSYSTEM[eco];
    if (lane) lanes.add(lane);
  }
  return [...lanes];
}

/**
 * 0054/A3 — the bounded retry budget for one lane, as child-process env vars.
 * A CAP, NOT A REROUTE: these tune retry TIMING only and never touch `registry`
 * / `index-url`. Takes npm's worst case from 70 s (10 s + 60 s of sleep) to ~1 s
 * and pip's from ~16 s to ~5 s, which is what bounds the damage when a registry
 * dies MID-RUN, after the preflight has already passed.
 */
export function retryEnvForLane(lane, { retries = DEFAULT_FETCH_RETRIES, maxTimeoutMs = DEFAULT_FETCH_RETRY_MAX_MS } = {}) {
  const capped = Math.max(0, Math.trunc(retries));
  const maxMs = Math.max(1, Math.trunc(maxTimeoutMs));
  // npm requires mintimeout <= maxtimeout; capping the MIN is what actually
  // removes the sleep (the ambient default is a 10 s first backoff).
  const minMs = Math.min(1000, maxMs);
  if (lane === "npm") {
    return {
      npm_config_fetch_retries: String(capped),
      npm_config_fetch_retry_mintimeout: String(minMs),
      npm_config_fetch_retry_maxtimeout: String(maxMs),
    };
  }
  if (lane === "pip") {
    return { PIP_RETRIES: String(capped), PIP_TIMEOUT: String(Math.max(1, Math.ceil(maxMs / 1000))) };
  }
  return {};
}

const isHttp = (value) => typeof value === "string" && /^https?:\/\//i.test(value.trim());

/**
 * Resolve one lane's endpoint FROM CONFIGURATION — CLI first, then env, then the
 * public default.
 *
 * The CLI probe runs from a NEUTRAL cwd (tmpdir), not the flow's cwd: `npm
 * config get registry` exits non-zero with `ENOWORKSPACES` when invoked inside
 * an npm workspace member — which is precisely where this pack runs. Asking from
 * tmpdir reads the user-level config, which is also what the CLONES see when
 * they install (they live outside this repo), so it is the more faithful answer,
 * not merely the more robust one.
 */
export async function resolveEndpoint(lane, { runner, env = process.env } = {}) {
  for (const argv of ENDPOINT_ARGV[lane] ?? []) {
    let out;
    try {
      out = await runner(argv, { cwd: tmpdir(), timeoutMs: 5000, allowNonZero: true });
    } catch {
      continue; // the front isn't installed — try the next one
    }
    const value = String(out?.stdout ?? "").trim();
    if (out?.exitCode === 0 && isHttp(value)) return { lane, endpoint: value, source: argv.join(" ") };
  }
  for (const key of ENDPOINT_ENV[lane] ?? []) {
    if (isHttp(env?.[key])) return { lane, endpoint: String(env[key]).trim(), source: `env ${key}` };
  }
  return { lane, endpoint: DEFAULT_ENDPOINT[lane] ?? null, source: "default" };
}

/** Name + locality of an endpoint, so the abort message can say "Verdaccio", not "a URL". */
export function describeEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return { name: null, local: false };
  }
  const local = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"].includes(url.hostname);
  if (local && url.port === "4873") return { name: "Verdaccio", local: true };
  if (local && url.port === "3141") return { name: "devpi", local: true };
  if (/registry\.npmjs\.org$/i.test(url.hostname)) return { name: "public npm registry", local: false };
  if (/pypi\.org$/i.test(url.hostname)) return { name: "PyPI", local: false };
  return { name: null, local };
}

/** Turn a fetch rejection into the phrase a human acts on. */
function errorText(err, timeoutMs) {
  const code = err?.cause?.code ?? err?.code ?? null;
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host not found";
  if (err?.name === "TimeoutError" || err?.name === "AbortError" || code === "ETIMEDOUT") return `no response within ${timeoutMs}ms`;
  return String(err?.message ?? err ?? "unreachable");
}

/**
 * What we actually GET: the endpoint's ORIGIN, never its configured path.
 *
 * Measured, and the reason this function exists: devpi's configured index-url is
 * `http://localhost:3141/root/pypi/+simple/`, and GETting that path makes devpi
 * render its whole proxied PyPI index — **40 MB in 1.57 s**. That blows any sane
 * probe budget, so a HEALTHY devpi would time out, be called unreachable, and
 * block every python install — the exact false-negative this module must never
 * produce (and it would pull 40 MB on every run to do it). The origin answers in
 * 33 ms with 6 KB, and answering AT ALL is the entire question a reachability
 * probe asks. The configured URL is still what we REPORT.
 */
export function probeTarget(endpoint) {
  try {
    return new URL(endpoint).origin;
  } catch {
    return endpoint;
  }
}

/**
 * Probe one endpoint. ANY HTTP answer — including 404 — means the registry is
 * UP (an auth-gated or path-less index still answers), so only a
 * connection-level failure counts as unreachable. That asymmetry is deliberate:
 * a false "unreachable" would block a healthy run, which is worse than the
 * 19-minute tax this module removes.
 */
export async function probeEndpoint(endpoint, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  try {
    const res = await fetchImpl(probeTarget(endpoint), { method: "GET", redirect: "manual", signal: globalThis.AbortSignal.timeout(timeoutMs) });
    return { reachable: true, status: typeof res?.status === "number" ? res.status : null, error: null };
  } catch (err) {
    return { reachable: false, status: null, error: errorText(err, timeoutMs) };
  }
}

/**
 * Probe every lane in play, once. Returns `{ ok, checked[], unreachable[] }` —
 * never throws, so the caller stays exit-code honest (0025/A1).
 */
export async function registryPreflight({ lanes = [], runner, fetchImpl, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  const checked = [];
  for (const lane of lanes) {
    const { endpoint, source } = await resolveEndpoint(lane, { runner });
    if (!endpoint) continue;
    const { name, local } = describeEndpoint(endpoint);
    const { reachable, status, error } = await probeEndpoint(endpoint, { fetchImpl, timeoutMs });
    checked.push({ lane, endpoint, source, name, local, reachable, status, error });
  }
  const unreachable = checked.filter((c) => !c.reachable);
  return { ok: unreachable.length === 0, checked, unreachable };
}

/** The abort message: name the real cause, the real fix, and the refusal to reroute. */
export function preflightMessage(result) {
  const unreachable = Array.isArray(result?.unreachable) ? result.unreachable : [];
  if (unreachable.length === 0) return null;
  const lines = unreachable.map((c) => `registry unreachable: ${c.endpoint}${c.name ? ` (${c.name})` : ""} — ${c.error}.`);
  if (unreachable.some((c) => c.local)) {
    lines.push("The local registries run in Docker. Start Docker Desktop and the Verdaccio/devpi containers, then re-run.");
  }
  lines.push("Refusing to fall back to the public registry — the local registry is intentional and load-bearing (@harness/core exists only there).");
  return lines.join("\n");
}

/** Lanes whose registry did not answer — the set A2's step guard rejects against. */
export const unreachableLanes = (result) =>
  new Set((Array.isArray(result?.unreachable) ? result.unreachable : []).map((c) => c.lane));
