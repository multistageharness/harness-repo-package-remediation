/**
 * src/service-health.mjs — the run's SERVICE-HEALTH probe (plan
 * run-health-and-errors-log, Epic 01): "are the services this run depends on
 * actually alive?", answered once, up front, and published as a first-class
 * fact every downstream stage — and the terminal errors stage — can QUOTE.
 *
 * WHY THIS EXISTS. Session f9f30203 scored four red builds whose sole cause was
 * environmental and total: Docker was down, so Verdaccio (`:4873`) and devpi
 * (`:3141`) refused every connection. The registry preflight (0054/0063,
 * `src/registry-preflight.mjs`) infers that state indirectly — both registries
 * refuse ⇒ probably Docker — but never NAMES it, so the run could never SAY
 * "Docker is not running". This module asks the question directly, with
 * `docker` as the first built-in probe, and keeps the answer structured enough
 * that the verdict header can print the remedy verbatim.
 *
 * DECLARATIVE, NOT HARD-CODED. The probed set defaults to
 * `[docker, verdaccio, devpi]` and is overridable via `harness.config.json`'s
 * `services:` array — "or any other service" is satisfied by a config entry,
 * never by editing this module. The probe STRATEGIES stay a closed set
 * (`docker` | `registry` | `http` | `port`): an arbitrary user-supplied argv
 * would be a command-injection surface for no real gain (security rule §4).
 *
 * REUSE, DON'T FORK. The registry probes DELEGATE to
 * `src/registry-preflight.mjs` (`resolveEndpoint` / `probeEndpoint` /
 * `describeEndpoint`) — that module already encodes three non-obvious,
 * measured traps (probe the ORIGIN, never the path — devpi's index renders
 * 40 MB; any HTTP answer including 404 is UP; endpoints come from the package
 * managers, not constants). A second probe implementation would re-learn all
 * three the hard way, and then drift.
 *
 * NEVER REROUTE (0054/D1; root CLAUDE.md): an unreachable local registry is
 * reported with its remedy — no code path here or downstream falls back to a
 * public registry (`@harness/core` exists only in the local Verdaccio).
 *
 * Purity: no clock, no fs, no shell strings. The argv runner, `fetch`, and TCP
 * connect are injected seams so the unit tests spawn zero processes and open
 * zero sockets; every subprocess is an argv LIST (security rule §4).
 * `probeServices` NEVER THROWS — a health probe that crashes the run it is
 * diagnosing is worse than no probe; an exploding probe yields
 * `status: "unknown"`.
 */

import { readFileSync } from "node:fs";
import { Socket } from "node:net";

import { harnessConfigPath } from "./llm/config.mjs";
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  describeEndpoint,
  probeEndpoint,
  resolveEndpoint,
} from "./registry-preflight.mjs";

// Re-exported so consumers of the health probe share the preflight's ceiling.
export { DEFAULT_PROBE_TIMEOUT_MS } from "./registry-preflight.mjs";

/**
 * Closed status vocabulary. `down` means the service ANSWERED and is not
 * running (docker's CLI reached us and said the daemon is off); `unreachable`
 * means NOTHING answered (a refused socket); `unknown` means the probe itself
 * failed (tool absent, probe exploded, timeout). The down/unreachable split is
 * what lets a verdict say "Docker is not running" instead of "something is
 * wrong with the network".
 */
export const SERVICE_STATUSES = Object.freeze(["up", "down", "unreachable", "unknown"]);

/** The remedy for the local Docker-backed registries — ONE source of truth. */
const DOCKER_REGISTRY_REMEDY = "The local registries run in Docker. Start Docker Desktop and the Verdaccio/devpi containers, then re-run.";

/**
 * The built-in service definitions, keyed by id. A config entry `{ id }` with
 * no `kind` inherits the built-in of the same id, so listing `docker` in
 * `harness.config.json` never means re-describing how to probe it.
 */
export const BUILT_IN_SERVICES = Object.freeze({
  docker: Object.freeze({
    id: "docker",
    kind: "docker",
    remedy: "Start Docker Desktop, then re-run.",
  }),
  verdaccio: Object.freeze({
    id: "verdaccio",
    kind: "registry",
    lane: "npm",
    remedy: DOCKER_REGISTRY_REMEDY,
  }),
  devpi: Object.freeze({
    id: "devpi",
    kind: "registry",
    lane: "pip",
    remedy: DOCKER_REGISTRY_REMEDY,
  }),
});

/** The default probe set when `harness.config.json` declares no `services:`. */
export const DEFAULT_SERVICE_IDS = Object.freeze(["docker", "verdaccio", "devpi"]);

/**
 * Normalize a configured (or defaulted) entry against the built-in registry.
 * Unknown ids with no kind stay probeable-as-unknown rather than throwing —
 * a typo in config must not crash the run this module exists to explain.
 */
export function resolveServiceSpec(entry) {
  if (typeof entry === "string") entry = { id: entry };
  const id = typeof entry?.id === "string" && entry.id.length > 0 ? entry.id : null;
  const builtIn = id ? BUILT_IN_SERVICES[id] : null;
  return { ...(builtIn ?? {}), ...(entry ?? {}), id: id ?? "unnamed-service" };
}

/**
 * Bound one probe promise by `timeoutMs`. An injected runner/fetch that never
 * settles must not hang the run (or the test suite), so the race timer is the
 * probe's hard ceiling. The timer is REFFED deliberately: it holds the loop for
 * at most `timeoutMs` (then is cleared), and unref'ing it would let the process
 * exit with the race unsettled — cancelling every test after the timeout one.
 */
function bounded(promise, timeoutMs) {
  let timer;
  const ceiling = new Promise((resolveRace) => {
    timer = setTimeout(() => resolveRace({ status: "unknown", detail: `probe timed out after ${timeoutMs}ms`, evidence: null }), timeoutMs);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

/** kind: docker — argv `["docker","info"]`; non-zero exit ⇒ the daemon is down. */
async function probeDocker(_spec, { runner, timeoutMs }) {
  const argv = ["docker", "info"];
  const out = await runner(argv, { timeoutMs, allowNonZero: true });
  if (out?.exitCode === 0) return { status: "up", detail: "docker daemon answered", evidence: { argv, exitCode: 0 } };
  const stderr = String(out?.stderr ?? "").split("\n")[0].trim();
  return {
    status: "down",
    detail: stderr || `docker info exited ${out?.exitCode ?? "non-zero"}`,
    evidence: { argv, exitCode: out?.exitCode ?? null },
  };
}

/**
 * kind: registry — DELEGATED to registry-preflight (see module header). The
 * endpoint is resolved from the package manager's own config; any HTTP answer
 * is UP; only a connection-level failure is `unreachable`.
 */
async function probeRegistry(spec, { runner, fetchImpl, timeoutMs }) {
  const { endpoint } = await resolveEndpoint(spec.lane, { runner });
  if (!endpoint) return { status: "unknown", detail: `no endpoint resolvable for lane '${spec.lane}'`, evidence: null };
  const { name, local } = describeEndpoint(endpoint);
  const { reachable, status, error } = await probeEndpoint(endpoint, { fetchImpl, timeoutMs });
  const label = name ?? spec.id;
  if (reachable) return { status: "up", detail: `${label} answered (HTTP ${status ?? "?"}) at ${endpoint}`, evidence: { endpoint, httpStatus: status } };
  return {
    status: "unreachable",
    detail: `${label} — ${error} at ${endpoint}`,
    evidence: { endpoint, error },
    // A non-local endpoint being unreachable is a network fact, not a Docker
    // one — don't prescribe Docker Desktop for a dead corporate proxy.
    ...(local ? {} : { remedy: `Registry ${endpoint} is unreachable — check network/VPN, then re-run.` }),
  };
}

/** kind: http — reachability GET against a configured origin (any answer = up). */
async function probeHttp(spec, { fetchImpl, timeoutMs }) {
  const target = spec.origin ?? spec.url;
  if (typeof target !== "string" || target.length === 0) return { status: "unknown", detail: "http probe has no 'origin'", evidence: null };
  const { reachable, status, error } = await probeEndpoint(target, { fetchImpl, timeoutMs });
  if (reachable) return { status: "up", detail: `answered (HTTP ${status ?? "?"}) at ${target}`, evidence: { endpoint: target, httpStatus: status } };
  return { status: "unreachable", detail: `${error} at ${target}`, evidence: { endpoint: target, error } };
}

/** Default TCP-connect seam for `kind: port` — resolves true on connect, false on refusal. */
function tcpConnect({ host, port, timeoutMs }) {
  return new Promise((resolveConnect, rejectConnect) => {
    const socket = new Socket();
    const done = (fn, value) => {
      socket.destroy();
      fn(value);
    };
    socket.setTimeout(timeoutMs, () => done(rejectConnect, new Error(`no answer within ${timeoutMs}ms`)));
    socket.once("error", (err) => done(rejectConnect, err));
    socket.connect(port, host, () => done(resolveConnect, true));
  });
}

/** kind: port — a bare TCP connect against `{ host, port }`. */
async function probePort(spec, { connectImpl, timeoutMs }) {
  const host = spec.host ?? "localhost";
  const port = Number(spec.port);
  if (!Number.isInteger(port) || port <= 0) return { status: "unknown", detail: "port probe has no valid 'port'", evidence: null };
  try {
    await connectImpl({ host, port, timeoutMs });
    return { status: "up", detail: `tcp connect ok to ${host}:${port}`, evidence: { host, port } };
  } catch (err) {
    return { status: "unreachable", detail: `${err?.message ?? err} at ${host}:${port}`, evidence: { host, port, error: String(err?.message ?? err) } };
  }
}

const PROBES_BY_KIND = { docker: probeDocker, registry: probeRegistry, http: probeHttp, port: probePort };

/**
 * Probe one service. Never throws: an exploding probe yields `unknown`.
 * @returns {Promise<{id: string, kind: string, status: string, detail: string, remedy: string|null, evidence: object|null}>}
 */
export async function probeService(entry, { runner, fetchImpl, connectImpl = tcpConnect, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  const spec = resolveServiceSpec(entry);
  const probe = PROBES_BY_KIND[spec.kind];
  let result;
  if (!probe) {
    result = { status: "unknown", detail: `unknown probe kind '${spec.kind ?? "(none)"}'`, evidence: null };
  } else {
    try {
      result = await bounded(probe(spec, { runner, fetchImpl, connectImpl, timeoutMs }), timeoutMs);
    } catch (err) {
      // Never let a probe abort the run it is diagnosing.
      result = { status: "unknown", detail: String(err?.message ?? err), evidence: null };
    }
  }
  return {
    id: spec.id,
    kind: spec.kind ?? null,
    status: result.status,
    detail: result.detail ?? "",
    // The remedy is DATA carried on the fact (one source of truth for the
    // verdict header + the CLI exit line) — only meaningful when not up.
    remedy: result.status === "up" ? null : result.remedy ?? spec.remedy ?? null,
    evidence: result.evidence ?? null,
  };
}

/**
 * Probe every configured service, once. `ok` is true iff no service is `down`
 * or `unreachable` (`unknown` does not block: a missing `docker` CLI on a CI
 * box that talks to a remote registry is not an outage). Never throws.
 * @param {{services?: Array<object|string>, runner?: Function, fetchImpl?: Function,
 *   connectImpl?: Function, timeoutMs?: number}} opts
 * @returns {Promise<{ok: boolean, services: Array<object>}>}
 */
export async function probeServices({ services, runner, fetchImpl, connectImpl, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  const list = Array.isArray(services) && services.length > 0 ? services : DEFAULT_SERVICE_IDS;
  const results = [];
  for (const entry of list) {
    results.push(await probeService(entry, { runner, fetchImpl, connectImpl, timeoutMs }));
  }
  return { ok: results.every((s) => s.status !== "down" && s.status !== "unreachable"), services: results };
}

/**
 * The declaratively configured service list: `harness.config.json`'s
 * `services:` array ("or any other service" = one config entry, zero code).
 * Missing file / missing key / malformed JSON all fall back to the built-in
 * default — the health probe must never be the thing that breaks the run.
 * @param {{env?: Record<string, string|undefined>, readFile?: (path: string) => string}} opts
 * @returns {Array<object|string>}
 */
export function configuredServices({ env = process.env, readFile = (p) => readFileSync(p, "utf8") } = {}) {
  try {
    const parsed = JSON.parse(readFile(harnessConfigPath(env)));
    const services = parsed?.services;
    if (Array.isArray(services) && services.length > 0) return services;
  } catch {
    // fall through to the default set
  }
  return [...DEFAULT_SERVICE_IDS];
}

/**
 * The one-line-per-service report for a degraded environment, remedy last —
 * mirrors `preflightMessage` in registry-preflight.mjs. Null when healthy.
 */
export function serviceHealthMessage(result) {
  const bad = (Array.isArray(result?.services) ? result.services : []).filter((s) => s.status === "down" || s.status === "unreachable");
  if (bad.length === 0) return null;
  const lines = bad.map((s) => `service ${s.id}: ${s.status} — ${s.detail}`);
  // Deduplicate remedies (the two registries share the Docker one) but keep order.
  const remedies = [...new Set(bad.map((s) => s.remedy).filter(Boolean))];
  lines.push(...remedies);
  return lines.join("\n");
}
