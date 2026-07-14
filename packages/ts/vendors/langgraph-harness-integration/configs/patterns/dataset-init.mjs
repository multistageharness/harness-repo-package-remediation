/**
 * commands.datasetInit — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): seed the shared `dataset`
 * spine channel from freshly-ingested rows. Reads a flat `rows_from` channel
 * (populated by `commands.harnessIngest`) and writes the `dataset` object with
 * `rows` echoed and `original_headers` derived from the first row's keys —
 * matching how `steps/preview.mjs` computes columns (`Object.keys(rows[0] ?? {})`).
 *
 * Rather than mutate the pristine `harness-ingest.mjs` atom to surface headers,
 * this atom keeps that bridge untouched and does the derivation here. It writes
 * ONLY `into` (the dataset channel), so the wrapNode write filter passes; it
 * reaches no provider SDK, no shell, no network — pure, deterministic, runs for
 * real even under mock (like `commands.fsRead`).
 */

/** The empty `dataset` shape — mirrors the flow yaml's `dataset` default. */
export function datasetDefaults() {
  return {
    original_headers: [],
    selected_headers: [],
    rows: [],
    repo_column: "",
    repos: [],
    clone_results: [],
  };
}

export const meta = {
  name: "commands.datasetInit",
  category: "commands",
  summary: "Seed the dataset spine from ingested rows: echo rows + derive original_headers.",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      rows_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function datasetInit(params) {
  return async (state) => {
    const rows = Array.isArray(state[params.rows_from]) ? state[params.rows_from] : [];
    const original_headers = Object.keys(rows[0] ?? {});
    return { [params.into]: { ...datasetDefaults(), rows, original_headers } };
  };
}
