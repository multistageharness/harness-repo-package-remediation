/**
 * steps/repo-column.mjs — identify the repo-URL column (langgraph-flow.md step 4)
 * and preview the deduped repo set before cloning. Presents the FULL header set
 * (the repo column may sit outside the remediation subset) with a smart default,
 * validates the pick against the parsed values (`validateRepoColumn`), and — once
 * accepted — computes the unique repo count in-process with the SAME
 * `normalizeRepoUrl` the `commands.collectRepos` atom uses, so the previewed count
 * matches execution exactly (no drift).
 *
 * A column whose values are not repo URLs re-prompts (bounded); zero unique repos
 * re-routes back to this step (StepRetry). Local reads are deterministic — runs
 * for real even under mock.
 */
import { WizardDone, StepRetry } from "../step-control.mjs";
import { normalizeRepoUrl, validateRepoColumn } from "../repo-url.mjs";

const MAX_ATTEMPTS = 5;
/** Preference order for the smart default — URL-bearing columns before `repo`. */
const DEFAULT_PREFERENCE = ["repo_url", "clone_url", "html_url", "url", "repo"];

/**
 * Pick the default repo column: the first preference present (case-insensitive),
 * else undefined (no default). Prefers `repo_url` over a bare `repo` name column.
 * @param {string[]} columns
 * @returns {string|undefined}
 */
export function pickDefaultRepoColumn(columns) {
  for (const pref of DEFAULT_PREFERENCE) {
    const hit = columns.find((c) => c.toLowerCase() === pref);
    if (hit) return hit;
  }
  return undefined;
}

/** Dedup a column through the shared normalizer, preserving first-seen order. */
function uniqueRepos(rows, column) {
  const seen = new Set();
  const repos = [];
  for (const row of rows) {
    const canonical = normalizeRepoUrl(row?.[column]);
    if (canonical === null || seen.has(canonical)) continue;
    seen.add(canonical);
    repos.push(canonical);
  }
  return repos;
}

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 */
export async function repoColumnStep(ctx) {
  const { ingest } = await import("@harness/sdk");
  const { rows } = await ingest(ctx.plan.inputPath, {});
  const columns = Object.keys(rows[0] ?? {});
  const defaultCol = pickDefaultRepoColumn(columns);

  let chosen;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const column = await ctx.prompt.select({
      message: "Which column holds the repo URL?",
      options: columns.map((c) => ({ value: c, label: c })),
      initialValue: defaultCol,
    });
    const { ok, reason } = validateRepoColumn(rows, column);
    if (ok) {
      chosen = column;
      break;
    }
    ctx.prompt.error(`That column doesn't look like repo URLs: ${reason}. Pick another.`);
  }
  if (chosen === undefined) throw new WizardDone(1);

  ctx.plan.repoColumn = chosen;

  // Dedup preview — same normalizer the atom uses, so the count matches the run.
  const repos = uniqueRepos(rows, chosen);
  if (repos.length === 0) {
    ctx.prompt.error("No repo URLs found in that column after normalization.");
    throw new StepRetry("repo-column", "no repo urls found");
  }
  const shown = repos.slice(0, 5).map((r) => `- ${r}`);
  if (repos.length > 5) shown.push(`… and ${repos.length - 5} more`);
  ctx.prompt.note(shown.join("\n"), `Repo column: ${chosen} — ${repos.length} unique repos`);
}
