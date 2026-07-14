/**
 * steps/ingest-source.mjs — the first step AFTER the session gate (change
 * records 0021/A3, 0024/A2): "first ask the user what they are ingesting".
 * `steps/session.mjs` precedes it; this was the wizard's first step until 0024.
 *
 * A `select` over the six lanes of `configs/flows/ingest.yaml` (see
 * `src/ingest-lanes.mjs` for the closed enum). The answer lands on
 * `ctx.plan.ingestSource` and becomes the `ingest_source` state channel the
 * child flow's `nodes.router` dispatches on.
 *
 * WHY A WIZARD STEP AND NOT AN IN-GRAPH PROMPT. The compiled `StateGraph` is
 * non-interactive. Collecting the selection in-graph would mean `nodes.interrupt`
 * (a HITL pause), which makes `ingest` interactive under `langgraph-langchain-harness run` and breaks
 * the `--mock`/offline acceptance contract (platform rule 3: an end-to-end run
 * with no human). So the selection is collected up front and passed into the
 * graph as a channel value. Revisit if a checkpointer-backed HITL run mode is
 * ever adopted (0021/A3, alternative considered).
 *
 * The non-CSV lanes never reach `preview` / `header-select` / `repo-column` —
 * there is no spreadsheet to parse — so this step seeds the two fields those
 * steps would otherwise have set. `repoColumn` is `repo_url`: the column
 * `commands.repoRowSynthesize` synthesizes and the placeholder lanes will emit.
 * An empty `selectedHeaders` is the identity selection (`commands.selectHeaders`
 * falls back to every original header), which is exactly right for a two-column
 * synthesized row.
 */
import { INGEST_LANES, isPlaceholderLane, isRepoSourceLane } from "../ingest-lanes.mjs";

/** What the non-CSV lanes get instead of walking the spreadsheet steps. */
const SYNTHESIZED_REPO_COLUMN = "repo_url";

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 */
export async function ingestSourceStep(ctx) {
  const choice = await ctx.prompt.select({
    message: "What are you ingesting?",
    options: INGEST_LANES.map((l) => ({ value: l.value, label: l.label, hint: l.hint })),
    initialValue: INGEST_LANES[0].value,
  });

  const lane = INGEST_LANES.find((l) => l.value === choice) ?? INGEST_LANES[0];
  ctx.plan.ingestSource = lane.value;

  if (lane.value !== "local_csv") {
    // Skip-step defaults — see the module header.
    ctx.plan.repoColumn ??= SYNTHESIZED_REPO_COLUMN;
    ctx.plan.selectedHeaders ??= [];
  }

  ctx.prompt.success(`Ingest source: ${lane.value} — ${lane.label}`);
  if (isPlaceholderLane(lane.value)) {
    ctx.prompt.warn(`The '${lane.value}' lane is a PLACEHOLDER: it routes and validates but ingests zero rows.`);
  } else if (isRepoSourceLane(lane.value)) {
    ctx.prompt.note(
      `The '${lane.value}' lane ingests the single array [${lane.value}] — one row of {repo, repo_url}, with no package/recommended_version. ` +
        `Remediation still runs: every dependency the fingerprint stage extracts is a candidate and its target comes from the registry. ` +
        `Step 3 (dataset_init → select_headers) is skipped — there is no spreadsheet to select headers from.`,
      "repo-source ingest",
    );
  }
}
