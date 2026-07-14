/**
 * commands.collectRepos — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): build the ordered, deduped
 * repo set (`langgraph-flow.md` step 5). Extracts the chosen column from
 * `dataset.rows`, canonicalizes each value through the shared `normalizeRepoUrl`
 * (so equivalent forms collapse — trailing slash, `.git`, SSH vs https, host
 * case), drops non-repo values, and dedups preserving first-seen order.
 *
 * KEY vs CLONE URL. `normalizeRepoUrl` is a DEDUP KEY: it rewrites the SCP-like
 * SSH form to https so `git@host:o/r.git` and `https://host/o/r` collapse to one
 * entry. That rewrite is LOSSY — it discards the transport, and with it any
 * SSH-key auth. So the canonical string is a key, never a clone target:
 *   - `dataset.repos` keeps the canonical strings (report + downstream joins);
 *   - `repos_into` carries `{ url, clone_url }` objects, where `clone_url` is the
 *     column value VERBATIM (or the row's own `clone_url`, when the ingest lane
 *     synthesized one), so `commands.gitCloneClassified` clones the transport the
 *     user actually supplied. Cloning the key instead made every private repo
 *     given as `git@…` fail with `remote: Repository not found`.
 * Dedup is on `url`; the FIRST-SEEN row's `clone_url` wins, matching the
 * first-seen ordering the rest of the atom already guarantees.
 *
 * Writes `into` (the dataset channel, with `repos` set) and — when `repos_into`
 * is given — ALSO mirrors the set into a flat array channel so the
 * `nodes.fanout` clone stage can iterate it (fan-out reads a top-level array
 * channel, not a nested `dataset.repos`). Reaches no provider SDK/shell/network;
 * runs for real under mock.
 *
 * The trust boundary restricts the MAPPING MODULE path (this file lives under
 * `configs/patterns/`, satisfied); it does not restrict this module's own
 * relative import of `../../src/repo-url.mjs`, which resolves inside the pack.
 */

import { normalizeRepoUrl } from "../../src/repo-url.mjs";

export const meta = {
  name: "commands.collectRepos",
  category: "commands",
  summary: "Extract + normalize + dedup the repo column into dataset.repos (+ optional flat {url, clone_url} channel).",
  params: {
    type: "object",
    required: ["dataset_from", "into"],
    properties: {
      dataset_from: { type: "string", minLength: 1 },
      column: { type: "string", minLength: 1 },
      column_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      repos_into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function collectRepos(params) {
  return async (state) => {
    const ds = state[params.dataset_from] ?? {};
    const column = params.column ?? state[params.column_from];
    const rows = Array.isArray(ds.rows) ? ds.rows : [];

    const seen = new Set();
    const repos = [];
    const entries = [];
    for (const row of rows) {
      const raw = row?.[column];
      const canonical = normalizeRepoUrl(raw);
      if (canonical === null || seen.has(canonical)) continue;
      seen.add(canonical);
      repos.push(canonical);
      // A lane that synthesized the row may have kept the ref verbatim; otherwise
      // the column value IS the reference the user supplied.
      const supplied = typeof row?.clone_url === "string" && row.clone_url.trim() !== ""
        ? row.clone_url.trim()
        : String(raw).trim();
      entries.push({ url: canonical, clone_url: supplied });
    }

    const delta = { [params.into]: { ...ds, repos } };
    if (params.repos_into) delta[params.repos_into] = entries;
    return delta;
  };
}
