/**
 * steps/mapping.mjs — resolve the mapping + assert the chosen lane's atoms.
 *
 * Lists the mappable patterns (grouped by category) from the pack mapping via the
 * vendored registry, then asserts the mapping actually provides the atoms the
 * run needs. A mapping load error (bad path / TrustBoundary) is surfaced and the
 * user is asked for an alternate mapping path (or `abort`).
 *
 * Change record 0021/A2 UN-PINS the ingest source here. Before 0021 this step
 * hard-assigned `ctx.plan.ingestPattern = "commands.harnessIngest"` because the
 * renderer emitted a fixed `{ path, out }` param shape that only that atom's
 * contract satisfied — offering a free `commands.*` pick would have emitted a
 * structurally invalid `nodes[0]` (record 0001/A1). With 0021/A1 the entry node
 * is ALWAYS `nodes.subgraph` over `configs/flows/ingest.yaml`, whose params are
 * constant across every selection, so there is no longer an "ingest pattern" to
 * pin: the user picks a LANE (the `ingest-source` step), and the child flow — not
 * the user — fixes that lane's atom params.
 *
 * What remains here is the assertion, and it becomes LANE-DEPENDENT: the chosen
 * lane's atoms (plus `nodes.subgraph` and the loud-failure lane every run needs)
 * must exist in the mapping, or the wizard fails clearly rather than mid-run.
 */
import { resolve } from "node:path";

import { WizardDone } from "../step-control.mjs";
import { createRegistry } from "../sdk.mjs";
import { ALWAYS_ATOMS, LANE_ATOMS } from "../ingest-lanes.mjs";

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 */
export async function mappingStep(ctx) {
  // Resolve a mapping path that loads, re-asking on error.
  let mappingPath = ctx.plan.mappingPath ?? resolve(ctx.pkgDir, "configs", "mapping.yaml");
  let registry;
  for (;;) {
    try {
      registry = await createRegistry(mappingPath);
      break;
    } catch (err) {
      ctx.prompt.error(`Could not load mapping '${mappingPath}': ${err.message}`);
      const answer = (await ctx.prompt.text({ message: "Alternate mapping path (or 'abort')" })).trim();
      if (answer === "" || answer.toLowerCase() === "abort") throw new WizardDone(1);
      mappingPath = resolve(ctx.cwd, answer);
    }
  }
  ctx.plan.mappingPath = mappingPath;

  // Show the mappable patterns grouped by category.
  const byCategory = await registry.describe();
  const catalog = Object.keys(byCategory)
    .sort()
    .map((category) => `${category}: ${byCategory[category].map((p) => p.name).sort().join(", ")}`)
    .join("\n");
  ctx.prompt.note(catalog, "Available patterns (from the pack mapping)");

  // Lane-dependent assertion (0021/A2). The ingest source is a user selection
  // again — but only over lanes this mapping can actually serve.
  const source = ctx.plan.ingestSource ?? "local_csv";
  const available = new Set(Object.values(byCategory).flat().map((p) => p.name));
  const needed = [...ALWAYS_ATOMS, ...(LANE_ATOMS[source] ?? [])];
  const missing = needed.filter((name) => !available.has(name));
  if (missing.length > 0) {
    ctx.prompt.error(
      `Mapping '${mappingPath}' does not provide ${missing.join(", ")} — the '${source}' ingest lane cannot run without it.`,
    );
    throw new WizardDone(1);
  }
  ctx.prompt.success(`Ingest lane '${source}' is served by: ${needed.join(", ")}`);
}
