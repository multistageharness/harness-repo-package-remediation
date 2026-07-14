/**
 * commands.selectHeaders — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): record the user's chosen
 * working subset in `dataset.selected_headers` WITHOUT discarding
 * `original_headers` or the full `rows`. The remediation subset is a view for
 * downstream stages; the originals stay in state for later reference
 * (`langgraph-flow.md` step 3).
 *
 * Pure/deterministic — reads the `dataset` channel + a `columns` list (inline or
 * from a channel), intersects the wanted columns with `original_headers`
 * (unknowns dropped defensively), and an empty/blank subset falls back to the
 * identity selection (all original headers), matching the step's "all" default.
 * Writes ONLY `into`; reaches no seam/shell/network; runs for real under mock.
 */

export const meta = {
  name: "commands.selectHeaders",
  category: "commands",
  summary: "Record dataset.selected_headers (subset of original_headers; empty ⇒ all).",
  params: {
    type: "object",
    required: ["dataset_from", "into"],
    properties: {
      dataset_from: { type: "string", minLength: 1 },
      columns: { type: "array", items: { type: "string" } },
      columns_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function selectHeaders(params) {
  return async (state) => {
    const ds = state[params.dataset_from] ?? {};
    const originals = Array.isArray(ds.original_headers) ? ds.original_headers : [];
    const wanted = params.columns ?? state[params.columns_from] ?? [];
    const chosen = Array.isArray(wanted) ? wanted.filter((c) => originals.includes(c)) : [];
    const selected = chosen.length > 0 ? chosen : originals;
    return { [params.into]: { ...ds, selected_headers: selected } };
  };
}
