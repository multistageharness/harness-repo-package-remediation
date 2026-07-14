/**
 * steps/confirm.mjs — the go/no-go gate. Print a summary of the walked config
 * (including the materialized yaml path) and ask for confirmation before the
 * wizard validates and runs the flow. Declining ends the wizard cleanly (the
 * orchestrator maps `false` → exit 0, no run).
 */
import { relative } from "node:path";

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 * @param {object} flowPlan the built FlowPlan
 * @param {string} yamlPath absolute path to the materialized flow yaml
 * @returns {Promise<boolean>} true → proceed to validate/run
 */
export async function confirmStep(ctx, flowPlan, yamlPath) {
  // 0021/A2: `ingestPattern` is gone — the entry node is always nodes.subgraph.
  // What the user chose is a LANE plus the reference that lane consumes.
  // 0024/D1.6: the session leads the summary, so the go/no-go gate names the
  // directory this run is about to write into (and whether it is a resume).
  const summary = [
    `session:        ${flowPlan.sessionId} (${ctx.plan.sessionOrigin ?? "new"})`,
    `session dir:    ${flowPlan.sessionDir}`,
    // Render-path seam: where THIS pack's own `.harness` tree lands. Named at the
    // gate for the same reason the session dir is — the user should not have to
    // guess which directory a run writes into, vendored pack or not.
    ...(ctx.plan.packRenderDir ? [`pack dir:       ${ctx.plan.packRenderDir}`] : []),
    `ingest source:  ${flowPlan.ingestSource}`,
    `ingest ref:     ${flowPlan.ingestRef || "(none — placeholder lane)"}`,
    `mapping:        ${flowPlan.mappingPath}`,
    `headers:        ${(flowPlan.selectedHeaders ?? []).join(", ") || "(all)"}`,
    `repo column:    ${flowPlan.repoColumn}`,
    `mode:           ${flowPlan.mock ? "mock (offline)" : "real (native git)"}`,
    // 0022/A2 landing note: with the renderer deriving from the committed flow,
    // the wizard's real-run path executes the remediate stage (0019/A3) for the
    // first time — surface the mutation at the gate, don't let it be discovered.
    // 0026/A1+A4: the install stage then writes node_modules/target/.venv into
    // each clone (deliberately AFTER snapshot, so snapshots stay pre-install).
    ...(flowPlan.mock
      ? []
      : [
          "⚠ real run:     the remediate stage bumps package.json IN PLACE inside each clone (0019/A3),",
          "                and the install stage writes node_modules/ target/ .venv into each clone (0026/A1)",
        ]),
    `output:         ${flowPlan.outDir}/${flowPlan.filename}`,
    `flow yaml:      ${relative(ctx.pkgDir, yamlPath)}`,
  ].join("\n");
  ctx.prompt.note(summary, "Configuration summary");
  return ctx.prompt.confirm({ message: "Validate and run this flow now?", initialValue: true });
}
