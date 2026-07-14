/**
 * src/materialize.mjs — persist the rendered flow to a gitignored scratch dir
 * so the vendored SDK/CLI can load it by path. `.runs/` is already in the pack
 * .gitignore, so nothing here is ever committed. Uses the vendored atomic
 * writer so a partially written yaml is never observable.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { renderFlowYaml } from "./render-flow.mjs";
import { writeFileAtomic } from "./sdk.mjs";

/**
 * @param {object} flowPlan a built FlowPlan (see flow-plan.mjs)
 * @param {string} pkgDir this pack's root
 * @returns {Promise<string>} absolute path to the written yaml
 */
export async function writeFlow(flowPlan, pkgDir) {
  const dir = resolve(pkgDir, ".runs", "wizard");
  await mkdir(dir, { recursive: true });
  const yamlPath = resolve(dir, `${flowPlan.name ?? "wizard-flow"}.yaml`);
  await writeFileAtomic(yamlPath, renderFlowYaml(flowPlan));
  return yamlPath;
}
