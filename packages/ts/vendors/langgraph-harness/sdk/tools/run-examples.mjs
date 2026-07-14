/**
 * tools/run-examples.mjs — compile + run every flow in configs/flows under
 * mock and report pass/fail. The acceptance harness `make run-examples` and
 * the e2e test suite shell out to.
 *
 * HITL flows interrupt by design: they count as PASS when the run reaches
 * `interrupted` status, and are then resumed with an approval to prove the
 * full loop.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRegistry, loadFlowConfig, validateFlow, compileFlow, runFlow, resumeFlow, scanFlows } from "@internal/langgraph-langchain-harness-sdk";

const here = dirname(fileURLToPath(import.meta.url));
const langgraphLangchainHarnessRoot = resolve(here, "..", "..");
const flowsDir = join(langgraphLangchainHarnessRoot, "configs", "flows");
const mappingPath = join(langgraphLangchainHarnessRoot, "configs", "mapping.yaml");

const only = process.argv[2];

const registry = await createRegistry(mappingPath);
const flows = await scanFlows(flowsDir);
let failures = 0;

for (const flow of flows) {
  if (only && flow.name !== only) continue;
  if (flow.name === "child-summarize") continue; // exercised via subgraph-parent
  const label = flow.name.padEnd(24);
  try {
    const { config } = await loadFlowConfig(flow.path);
    const validation = await validateFlow(config, { mapping: registry.mapping });
    if (!validation.ok) {
      failures++;
      console.log(`FAIL ${label} validation: ${validation.issues[0].path}: ${validation.issues[0].message}`);
      continue;
    }
    const compiled = await compileFlow(config, { registry, options: { mock: true } });
    let result = await runFlow(compiled, { threadId: `examples-${flow.name}-${Date.now()}` });
    let note = "";
    if (result.status === "interrupted") {
      note = ` interrupt("${result.interrupt?.message ?? ""}") → resume(approve)`;
      result = await resumeFlow(compiled, { threadId: result.threadId, resume: { approve: true } });
    }
    if (result.status !== "completed") {
      failures++;
      console.log(`FAIL ${label} ended ${result.status}${note}`);
      continue;
    }
    const errors = result.state.error_logs?.length ?? 0;
    console.log(`PASS ${label} last_step=${result.state.last_step}${errors ? ` error_logs=${errors}` : ""}${note}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${label} ${err.constructor.name}: ${err.message}`);
  }
}

console.log(failures === 0 ? "\nall examples passed" : `\n${failures} example(s) failed`);
process.exit(failures === 0 ? 0 : 1);
