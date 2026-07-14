/**
 * commands.registryPreflight — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the once-per-run
 * registry-reachability stage (change record 0063/A2, completing 0054/D1).
 *
 * WHY A STAGE. 0054 built the probe (`src/registry-preflight.mjs`) and wired it
 * into exactly ONE consumer — `commands.installRun` computed it inside its own
 * handler, where the result died. `build-run` then walked blind into the same
 * dead registry the install stage had already proved unreachable: `python3 -m
 * build` bootstraps a PEP-517 isolated env and pip-installs `hatchling` from
 * the dead devpi, five retries, `CalledProcessError` — a **red build** for an
 * environmental outage (session f9f30203). A probe that guards `install` and
 * lets `build` pay the toll is a fail-fast gate with a hole in it.
 *
 * This atom makes the preflight a RUN-SCOPED FACT: probed once, before the
 * install stage, published on a channel (`registry_preflight`) that
 * `install-run`, `build-run`, and `test-run` all read via `preflight_from`.
 * Each consumer applies the same `registrySkip` guard to its own argv; a stage
 * whose lane is dead records `skipped: "registry-unreachable"`,
 * `cause: "environment"` → the repo is `blocked` — never a build failure.
 *
 * NEVER REROUTE (0054/D1 note; root CLAUDE.md): on an unreachable registry this
 * stage reports loudly and the consumers skip — no code path falls back to
 * `registry.npmjs.org` / `pypi.org`. The local Verdaccio is load-bearing
 * (`@harness/core` exists only there); surfacing the Docker state IS the fix.
 *
 * Only the lanes actually IN PLAY are probed (derived from the integrated
 * manifests' `modules[].ecosystem`) — a maven-only run is never blocked by a
 * dead devpi, and a run with no registry-resolving ecosystem probes nothing.
 *
 * Real-vs-mock contract (platform rule 3 + security rule §8): under `--mock`
 * (default) the atom is a pure state transform returning one deterministic
 * `{ placeholder: true, ok: true, lanes: [], checked: [], unreachable: [] }`
 * stub — no fs, no subprocess, NO SOCKET — so the offline verify gate never
 * probes anything.
 *
 * Trust boundary: lives under `configs/patterns/`; imports only the pack's own
 * `src/` bridges. Every subprocess (the `npm config get registry` endpoint
 * resolution inside the probe) is an argv list (security rule §4).
 */

import { runArgv } from "../../src/sdk.mjs";
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  lanesForEcosystems,
  preflightMessage,
  registryPreflight,
} from "../../src/registry-preflight.mjs";

export const meta = {
  name: "commands.registryPreflight",
  category: "commands",
  summary:
    "Once-per-run registry reachability preflight (0063/A2): probe the configured endpoints for the lanes in play and publish the result as a run-scoped channel install/build/test all consume; deterministic stub under mock.",
  params: {
    type: "object",
    required: ["integrated_from", "into"],
    properties: {
      // Channel holding the integrated manifests — `modules[].ecosystem` names
      // the lanes in play.
      integrated_from: { type: "string", minLength: 1 },
      // Channel the run-scoped preflight result is written into.
      into: { type: "string", minLength: 1 },
      // Per-endpoint probe ceiling (a refused connect answers in ~0.1 s).
      timeout_ms: { type: "integer", minimum: 1 },
    },
  },
  returns: "node",
};

/** Test seam: build the factory over an injected argv runner + prober. */
export function _registryPreflightWith({ runner = runArgv, preflight = registryPreflight } = {}) {
  return function registryPreflightFactory(params, ctx) {
    return async (state) => {
      // Mock (default): pure state transform — no fs, no subprocess, NO SOCKET.
      if (ctx.options.mock) {
        return { [params.into]: { placeholder: true, ok: true, lanes: [], checked: [], unreachable: [] } };
      }

      const entries = Array.isArray(state[params.integrated_from]) ? state[params.integrated_from] : [];
      const ecosystems = entries.flatMap((e) => (Array.isArray(e?.modules) ? e.modules.map((m) => m?.ecosystem) : []));
      const lanes = lanesForEcosystems(ecosystems);
      if (lanes.length === 0) {
        // No registry-resolving ecosystem in play — nothing to probe, nothing dead.
        return { [params.into]: { placeholder: false, ok: true, lanes, checked: [], unreachable: [] } };
      }

      const timeoutMs = Number.isInteger(params.timeout_ms) && params.timeout_ms > 0 ? params.timeout_ms : DEFAULT_PROBE_TIMEOUT_MS;
      const result = await preflight({ lanes, runner, timeoutMs });
      if (!result.ok) {
        // The ONE loud, actionable report for the whole run — the consumers'
        // per-step `registry-unreachable` skips carry the same facts as data.
        ctx.emit?.("loop.guard", {
          node: ctx.node?.id,
          kind: "registry-preflight",
          lanes: result.unreachable.map((c) => c.lane),
          message: preflightMessage(result),
        });
      }
      return { [params.into]: { placeholder: false, ok: result.ok, lanes, checked: result.checked, unreachable: result.unreachable } };
    };
  };
}

export const registryPreflightRun = _registryPreflightWith({});
