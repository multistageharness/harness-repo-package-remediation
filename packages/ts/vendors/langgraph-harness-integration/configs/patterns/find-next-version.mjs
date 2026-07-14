/**
 * commands.findNextVersion — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the flow surface of the
 * shared install-test VERSION-DISCOVERY engine (change record 0033/D0,
 * `src/version-discovery.mjs`). One atom, three verbs, nine package managers
 * (0033/D1–D9) — "find the next available version" as a langgraph
 * tools:function, modeled on `harness-ingest.mjs`:
 *
 *   - exports `meta` (name === mapping key, category === "commands") + ONE
 *     factory; the factory writes ONLY `out`, so the wrapNode write filter
 *     passes.
 *   - reaches NO provider SDK and NO model seam. Under `ctx.options.mock` the
 *     engine short-circuits to a deterministic synthetic result derived from
 *     the package name — zero HTTP, zero subprocess, zero scratch dir — so the
 *     offline acceptance contract holds. A REAL run install-tests candidates
 *     via argv-list subprocesses in an isolated scratch dir (security rule §4);
 *     registry credentials come from env at the seam (rule §5).
 *
 * Verbs (default `find`):
 *   - `versions` — list what the datasource advertises (`Release[]`,
 *     provenance mandatory).
 *   - `find` — rank candidates above `current` by the ecosystem's version
 *     grammar, install-test each, stop at the FIRST that installs.
 *   - `test` — install-test every ranked candidate (or the newest `limit`);
 *     `report_path` additionally writes the JSON report (resolved against the
 *     flow dir, like every config-relative atom path).
 */

import { isAbsolute, resolve } from "node:path";

import { TOOL_PACKAGE_MANAGERS } from "../../src/tool-registry.mjs";
import { versions as discoverVersions, find as findNext, test as testVersions } from "../../src/version-discovery.mjs";

export const meta = {
  name: "commands.findNextVersion",
  category: "commands",
  summary:
    "Version discovery (0033/D0): list advertised versions, find the next install-verified version, or install-test candidates for one package under one package manager — mock-first, argv-list, scratch-dir isolated.",
  params: {
    type: "object",
    required: ["package_manager", "out"],
    properties: {
      package_manager: { enum: [...TOOL_PACKAGE_MANAGERS] },
      verb: { enum: ["versions", "find", "test"] },
      package: { type: "string", minLength: 1 },
      package_from: { type: "string", minLength: 1 },
      current: { type: "string", minLength: 1 },
      current_from: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1 },
      order: { enum: ["desc", "asc"] },
      timeout_ms: { type: "integer", minimum: 1 },
      registry_url: { type: "string", minLength: 1 },
      report_path: { type: "string", minLength: 1 },
      out: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

const VERBS = { versions: discoverVersions, find: findNext, test: testVersions };

export function findNextVersion(params, ctx) {
  return async (state) => {
    const pkg = params.package_from ? state[params.package_from] : params.package;
    if (typeof pkg !== "string" || pkg.length === 0) {
      throw new Error(
        `commands.findNextVersion: no package (set 'package', or 'package_from' → a channel holding a non-empty string; package_from='${params.package_from ?? ""}')`,
      );
    }
    const current = params.current_from ? (state[params.current_from] ?? null) : (params.current ?? null);
    const opts = {};
    if (typeof current === "string" && current.length > 0) opts.current = current;
    if (params.limit != null) opts.limit = params.limit;
    if (params.order) opts.order = params.order;
    if (params.timeout_ms != null) opts.timeoutMs = params.timeout_ms;
    if (params.registry_url) opts.registryUrl = params.registry_url;
    if (params.report_path) {
      opts.reportPath = isAbsolute(params.report_path) ? params.report_path : resolve(ctx.options.baseDir, params.report_path);
    }
    const run = VERBS[params.verb ?? "find"];
    const result = await run(params.package_manager, pkg, opts, ctx);
    return { [params.out]: result };
  };
}
