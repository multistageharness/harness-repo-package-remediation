/**
 * commands.serviceHealth — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the run's FIRST node
 * (plan run-health-and-errors-log, Epic 01 / Feature 02).
 *
 * WHY A STAGE, AND WHY FIRST. Session f9f30203's four "red builds" had one
 * total, environmental cause — Docker down, both local registries refusing —
 * and the pipeline had every fact needed to say so and said none of them. The
 * registry preflight (0063/A2, node `preflight`) publishes the LANE-level
 * gating fact, but it runs mid-flow (it needs the integrated manifests to know
 * which lanes are in play) and never NAMES Docker. This node asks the direct
 * question — "are the services this run depends on alive?" — before the first
 * repo is cloned, so a dead environment is known before the run pays for ten
 * clones, and publishes it on the `service_health` channel the terminal errors
 * stage quotes verbatim.
 *
 * The probed set is DECLARATIVE: `harness.config.json`'s `services:` array,
 * defaulting to `[docker, verdaccio, devpi]` — adding a service is a config
 * entry, never an atom edit (src/service-health.mjs owns the closed strategy
 * set and delegates the registry probes to src/registry-preflight.mjs).
 *
 * FAST-FAIL HALF vs CONSOLIDATED HALF: a degraded environment emits one
 * `loop.guard` event (kind `service-health`) that run-flow.mjs prints
 * immediately — the operator sees "Docker is not running" at the top of the
 * run, not only in the errors ledger at the end. The node itself NEVER aborts:
 * reporting is the feature, gating stays with the lane-level preflight guard.
 *
 * Real-vs-mock contract (platform rule 3 + security rule §8): under `--mock`
 * (default) the atom is a pure state transform returning one deterministic
 * `{ placeholder: true, ok: true, services: [] }` stub — no fs, no subprocess,
 * NO SOCKET — so the offline verify gate never probes anything.
 *
 * Trust boundary: lives under `configs/patterns/`; imports only the pack's own
 * `src/` bridges. Every subprocess is an argv list (security rule §4).
 */

import { runArgv } from "../../src/sdk.mjs";
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  configuredServices,
  probeServices,
  serviceHealthMessage,
} from "../../src/service-health.mjs";

export const meta = {
  name: "commands.serviceHealth",
  category: "commands",
  summary:
    "Run-scoped service-health probe (run-health-and-errors-log Epic 01): probe the declaratively configured services (docker, verdaccio, devpi, …) once, before ingest, and publish the fact on a channel; deterministic stub under mock.",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      // Channel the run-scoped health fact is written into.
      into: { type: "string", minLength: 1 },
      // Per-service probe ceiling (a refused connect answers in ~0.1 s).
      timeout_ms: { type: "integer", minimum: 1 },
    },
  },
  returns: "node",
};

/** Test seam: build the factory over injected probe/config seams. */
export function _serviceHealthWith({ runner = runArgv, probe = probeServices, services = configuredServices } = {}) {
  return function serviceHealthFactory(params, ctx) {
    return async (state) => {
      void state;
      // Mock (default): pure state transform — no fs, no subprocess, NO SOCKET.
      if (ctx.options.mock) {
        return { [params.into]: { placeholder: true, ok: true, services: [] } };
      }

      const timeoutMs = Number.isInteger(params.timeout_ms) && params.timeout_ms > 0 ? params.timeout_ms : DEFAULT_PROBE_TIMEOUT_MS;
      const result = await probe({ services: services(), runner, timeoutMs });
      if (!result.ok) {
        // The fast-fail half: printed by run-flow the moment it happens. The
        // consolidated half is the terminal errors stage quoting this channel.
        ctx.emit?.("loop.guard", {
          node: ctx.node?.id,
          kind: "service-health",
          services: result.services.filter((s) => s.status === "down" || s.status === "unreachable").map((s) => s.id),
          message: serviceHealthMessage(result),
        });
      }
      return { [params.into]: { placeholder: false, ok: result.ok, services: result.services } };
    };
  };
}

export const serviceHealth = _serviceHealthWith({});
