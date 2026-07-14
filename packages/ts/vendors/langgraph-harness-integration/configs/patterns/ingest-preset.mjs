/**
 * commands.ingestPreset — CUSTOM pattern (project-local; change record 0021/D4,
 * made REAL for langgraph-flow.md capability 1): the `preset_list` lane of the
 * ingest sub-langgraph. Reads a committed JSON repo LIST (an array of repo URLs,
 * e.g. `fixtures/git-ssh-repos.json` / `fixtures/git-http-repos.json`) and
 * synthesizes the same `{ repo, repo_url, clone_url }` rows that
 * `commands.repoRowSynthesize` produces for a single repo — so a whole preset of
 * repos flows through the exact `rows` → `dataset` spine every downstream stage
 * already consumes (clone → fingerprint → plan → remediate → …), with zero
 * downstream change.
 *
 * ACCEPTED SHAPES (tolerant, so the same lane reads either fixture form):
 *   - `["git@…", "https://…", …]`               — an array of repo-URL strings
 *   - `[{ "repo_url": "…" }, { "url": "…" }, …]` — an array of objects
 *   - `{ "repos": [ … ] }`                       — an object wrapping either
 * Each entry is canonicalized through `src/repo-url.mjs` (`looksLikeRepoUrl` +
 * `normalizeRepoUrl`), exactly as `commands.repoRowSynthesize` does: `repo_url` is
 * the canonical https DEDUP KEY, `clone_url` is the reference VERBATIM (so an ssh
 * ref keeps its key auth).
 *
 * NEVER EMPTY-BUT-GREEN (0021/D1 discipline): an unreadable / unparseable file, a
 * non-list payload, or a list with zero VALID repo URLs THROWS — a preset that
 * silently ingests nothing reads as a clean run. Individual invalid entries are
 * skipped with a diagnostic; a file of all-invalid entries throws.
 *
 * Path resolution mirrors `commands.harnessIngest` exactly — `path_from`
 * (`ingest_ref`) is resolved against `ctx.options.baseDir` when relative, so the
 * committed relative default and a wizard-absolute path both work. Reading a
 * committed local JSON file is pure + offline, so this lane runs for real under
 * `--mock` (no network, no git) — the same way the local_csv lane reads its CSV.
 *
 * Security (v100-security-rules.md §4/§1): no subprocess, no interpolation; the
 * file is parsed as DATA. The repo URLs are treated as references, never executed.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { looksLikeRepoUrl, normalizeRepoUrl } from "../../src/repo-url.mjs";

export const meta = {
  name: "commands.ingestPreset",
  category: "commands",
  summary: "Preset-list ingest lane: read a JSON array of repo URLs into {repo, repo_url, clone_url} rows (offline, mock-safe).",
  params: {
    type: "object",
    required: ["out"],
    properties: {
      // path to the JSON repo-list file (a channel holding the path)
      preset_from: { type: "string", minLength: 1 },
      // or an inline path, when no channel carries it
      preset: { type: "string", minLength: 1 },
      out: { type: "string", minLength: 1 },
      // optional channel receiving `{ path, count, rows, skipped }`
      result_into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

/** `https://host/owner/name` → `owner/name`. */
function ownerSlug(canonicalUrl) {
  const parts = canonicalUrl.split("/");
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/** Pull a repo reference out of a list entry (string or object). */
function refOf(entry) {
  if (typeof entry === "string") return entry.trim();
  if (entry && typeof entry === "object") {
    for (const key of ["repo_url", "url", "clone_url", "repo"]) {
      if (typeof entry[key] === "string" && entry[key].trim().length > 0) return entry[key].trim();
    }
  }
  return null;
}

/** Normalize a parsed JSON payload to an array of entries. */
function toEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.repos)) return payload.repos;
  return null;
}

export function ingestPreset(params, ctx) {
  return async (state) => {
    const rel = params.preset_from ? state[params.preset_from] : params.preset;
    if (typeof rel !== "string" || rel.trim() === "") {
      throw new Error(`commands.ingestPreset: no preset source (set 'preset' or 'preset_from' → a channel holding a JSON repo-list path)`);
    }
    const path = isAbsolute(rel) ? rel : resolve(ctx.options.baseDir, rel);

    let text;
    try {
      text = await readFile(path, "utf8");
    } catch (err) {
      throw new Error(`commands.ingestPreset: cannot read preset repo-list '${path}': ${err.message}`, { cause: err });
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      throw new Error(`commands.ingestPreset: preset repo-list '${path}' is not valid JSON: ${err.message}`, { cause: err });
    }
    const entries = toEntries(payload);
    if (entries === null) {
      throw new Error(`commands.ingestPreset: preset repo-list '${path}' must be a JSON array of repo URLs (or { "repos": [...] })`);
    }

    const rows = [];
    const skipped = [];
    const seen = new Set();
    for (const entry of entries) {
      const ref = refOf(entry);
      if (!ref || !looksLikeRepoUrl(ref)) {
        skipped.push({ entry, reason: "not a clonable repo URL" });
        continue;
      }
      const repo_url = normalizeRepoUrl(ref);
      if (repo_url === null || seen.has(repo_url)) {
        if (repo_url !== null) skipped.push({ entry, reason: "duplicate repo_url" });
        else skipped.push({ entry, reason: "not canonicalizable" });
        continue;
      }
      seen.add(repo_url);
      rows.push({ repo: ownerSlug(repo_url), repo_url, clone_url: ref });
    }

    if (rows.length === 0) {
      throw new Error(`commands.ingestPreset: preset repo-list '${path}' yielded zero valid repo URLs (${entries.length} entr${entries.length === 1 ? "y" : "ies"} read) — never an empty-but-green run`);
    }

    const delta = { [params.out]: rows };
    if (params.result_into) delta[params.result_into] = { path, count: rows.length, rows, skipped };
    return delta;
  };
}
