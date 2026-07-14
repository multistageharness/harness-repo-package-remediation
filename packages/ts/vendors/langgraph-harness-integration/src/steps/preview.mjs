/**
 * steps/preview.mjs — show the user what `@harness/sdk` parsed before they
 * commit to a file. Calls `ingest()` with a small `limit`, prints a compact,
 * deterministic preview (columns + first N rows + total), and surfaces any
 * ingest diagnostics. An `error`-severity diagnostic re-routes back to the
 * input-file step (StepRetry) rather than proceeding with bad data.
 *
 * Local file reads are deterministic, so this runs for real even under mock.
 */
import { StepRetry } from "../step-control.mjs";

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 * @param {{limit?: number}} [opts]
 */
export async function previewStep(ctx, { limit = 5 } = {}) {
  const { ingest } = await import("@harness/sdk");
  const res = await ingest(ctx.plan.inputPath, { limit });

  const diagnostics = Array.isArray(res.diagnostics) ? res.diagnostics : [];
  let hasError = false;
  for (const d of diagnostics) {
    if (d.severity === "warning" || d.severity === "error") {
      (d.severity === "error" ? ctx.prompt.error : ctx.prompt.warn)(`[${d.severity}] ${d.code}: ${d.message}`);
      if (d.severity === "error") hasError = true;
    }
  }
  if (hasError) {
    ctx.prompt.error("Ingest reported an error — please choose a different file.");
    throw new StepRetry("input-file", "ingest error diagnostic");
  }

  const rows = Array.isArray(res.rows) ? res.rows : [];
  const columns = Object.keys(rows[0] ?? {});
  const total = res.meta?.rowCount ?? rows.length;

  const body = [
    `columns: ${columns.join(", ") || "(none)"}`,
    ...rows.slice(0, limit).map((row, i) => {
      const cells = columns.map((c) => `${c}=${String(row[c] ?? "")}`).join(", ");
      return `row ${i + 1}: ${cells}`;
    }),
    `total rows: ${total}`,
  ].join("\n");
  ctx.prompt.note(body, `Preview of ${ctx.plan.inputPath}`);
}
