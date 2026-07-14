/**
 * commands.ingestDependabot — CUSTOM pattern (project-local; change record
 * 0021/D4): the `dependabot` lane of the ingest sub-langgraph. Ships as a
 * PLACEHOLDER extractor (0017's discipline), returning zero rows.
 *
 * WHY THIS LANE MATTERS. Its eventual output maps 1:1 onto the columns the
 * remediation spine already consumes — `repo_url`, `package`, `severity`,
 * `recommended_version`. `fixtures/dependabot-remediation-testcases.csv` was
 * DERIVED from exactly this data. So of the five non-local-CSV lanes, this is the
 * only one that gives `remediate` an ADVISORY target (`recommended_version` — the
 * fix version the alert names). The repo-source lanes remediate too (0023/A1),
 * but their targets come from the registry's latest stable release, not from a
 * vulnerability advisory.
 *
 * BINDING CONSTRAINTS when it becomes real (v100-security-rules.md):
 *   §3 — native `gh` CLI only: `gh api /repos/{owner}/{repo}/dependabot/alerts`.
 *        No MCP GitHub connector. No service-account token in code or yaml.
 *   §4 — argv-list subprocess: `execFile("gh", ["api", …])`, never an
 *        interpolated command string.
 *   §1/§2 — the alert bodies (summaries, descriptions) are untrusted external
 *        text: they pass `commands.sanitizeUntrusted` before reaching any
 *        `skills.*` node, and embedded directives are reported as findings.
 *   §5 — `GH_TOKEN` is read from env at the seam, never from flow yaml.
 *
 * A placeholder lane drives an EMPTY BUT GREEN run. `src/steps/report.mjs` prints
 * an explicit `placeholder — no rows ingested` warning so that outcome is never
 * mistaken for a clean one (0021/D4 note).
 *
 * Pure + deterministic, mock or not: no fs, no network, no seam, no shell.
 */

export const meta = {
  name: "commands.ingestDependabot",
  category: "commands",
  summary: "PLACEHOLDER — GitHub Dependabot ingest lane: returns zero rows until the `gh api` integration lands (0021/D4).",
  params: {
    type: "object",
    required: ["out"],
    properties: {
      // the repo (owner/name or url) whose alerts to read, once real
      ref_from: { type: "string", minLength: 1 },
      ref: { type: "string", minLength: 1 },
      out: { type: "string", minLength: 1 },
      // optional channel receiving `{ placeholder: true, ref, rows: [] }`
      result_into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function ingestDependabot(params) {
  return async (state) => {
    const ref = (params.ref_from ? state[params.ref_from] : params.ref) ?? null;
    const rows = [];
    const delta = { [params.out]: rows };
    if (params.result_into) delta[params.result_into] = { placeholder: true, ref, rows };
    return delta;
  };
}
