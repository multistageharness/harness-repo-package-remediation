/**
 * commands.repoRowSynthesize — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml; change record 0021/D3):
 * turn ONE repo reference — a local clone directory or a remote repo URL — into
 * the single-row dataset the user described ("like a single row of CSV that will
 * be scanned"), so a repo can be ingested through the exact same `rows` →
 * `dataset` spine every downstream stage already consumes. Zero downstream
 * change: `dataset_init` derives `original_headers` from the row, and
 * `collect_repos` dedups `repo_url` as it always has.
 *
 * Output row shape — deliberately just the columns `collect_repos`
 * (`column: repo_url`) and the report need:
 *   [{ repo: "<owner>/<name>", repo_url: "<canonical https url>",
 *      clone_url: "<the reference exactly as supplied>" }]
 * `repo_url` is the CANONICAL DEDUP KEY (always https, host lower-cased); it is
 * NOT necessarily clonable. `clone_url` is the reference verbatim — the transport
 * the caller actually chose. Cloning `repo_url` instead of `clone_url` is what
 * turned `git@github.com:owner/private-repo.git` into an unauthenticated https
 * fetch and made a private repo report `remote: Repository not found`. Keep both:
 * dedup on `repo_url`, clone `clone_url`.
 * There is NO `package` / `severity` / `recommended_version`: those come from a
 * Dependabot spreadsheet, not from a repo URL. That absence is a ROUTING SIGNAL,
 * not a dead end (record 0023): the parent flow's `dataset_init` switch skips
 * `select_headers` (nothing to select from a two-column synthesized row), and
 * `commands.repoRemediate` sees a dataset with no `package` column and takes the
 * repo's OWN extracted dependencies as its bump candidates, resolving each target
 * from the registry. A repo-source run remediates; it is not a scan.
 *
 * URL canonicalization reuses `src/repo-url.mjs` — the same `looksLikeRepoUrl`
 * guard and `normalizeRepoUrl` normalizer the wizard preview and
 * `commands.collectRepos` use — so a repo ingested here dedups and clones
 * identically to one ingested from a spreadsheet. Never re-implemented here.
 *
 * Security (v100-security-rules.md §4): the one subprocess — reading a local
 * clone's `origin` remote — goes through `execFile` with an ARGV LIST
 * (`["-C", dir, "remote", "get-url", "origin"]`). No interpolated command
 * string; injection is structurally impossible.
 *
 * Mock seam (rule 8 / platform rule 3): under `ctx.options.mock` the `local`
 * kind returns a deterministic stub row and never touches the filesystem or
 * spawns `git`. The `remote` kind is pure string canonicalization and so runs
 * for real under mock too — no network is involved in normalizing a URL.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import { looksLikeRepoUrl, normalizeRepoUrl } from "../../src/repo-url.mjs";

const execFileAsync = promisify(execFile);

export const meta = {
  name: "commands.repoRowSynthesize",
  category: "commands",
  summary: "Synthesize a single-row dataset ({repo, repo_url}) from one local clone dir or remote repo URL.",
  params: {
    type: "object",
    required: ["ref_from", "kind", "out"],
    properties: {
      ref_from: { type: "string", minLength: 1 },
      kind: { enum: ["local", "remote"] },
      out: { type: "string", minLength: 1 },
      // optional channel for non-fatal diagnostics (e.g. a local clone with no
      // `origin`). Point it at `error_logs` to fold them into the run's
      // diagnostics — a zero-repo run is then explained, never silent.
      diagnostics_into: { type: "string", minLength: 1 },
      // bounded execution (platform rule 4) for the `git remote get-url` call
      timeout_ms: { type: "integer", minimum: 1, maximum: 120000 },
    },
  },
  returns: "node",
};

/** Deterministic offline stub for the `local` kind under `--mock`. */
const MOCK_LOCAL_ROW = {
  repo: "acme/mock-local-repo",
  repo_url: "https://github.com/acme/mock-local-repo",
  clone_url: "https://github.com/acme/mock-local-repo",
};

/** `https://host/owner/name` → `owner/name`. */
function ownerSlug(canonicalUrl) {
  const parts = canonicalUrl.split("/");
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function repoRowSynthesize(params, ctx) {
  return async (state) => {
    const ref = state[params.ref_from];
    if (typeof ref !== "string" || ref.trim() === "") {
      throw new Error(`commands.repoRowSynthesize: channel '${params.ref_from}' holds no repo reference`);
    }
    const diagnostics = [];
    const emit = (rows) => {
      const delta = { [params.out]: rows };
      if (params.diagnostics_into && diagnostics.length > 0) delta[params.diagnostics_into] = diagnostics;
      return delta;
    };

    if (params.kind === "remote") {
      // Reject exactly what `looksLikeRepoUrl` rejects — loudly. An unusable
      // reference must never degrade into a zero-row (green, empty) run.
      if (!looksLikeRepoUrl(ref)) {
        throw new Error(`commands.repoRowSynthesize: '${ref}' is not a clonable repo URL (https://host/owner/repo or git@host:owner/repo)`);
      }
      const repo_url = normalizeRepoUrl(ref);
      // clone_url is the ref VERBATIM — canonicalization is lossy on transport.
      return emit([{ repo: ownerSlug(repo_url), repo_url, clone_url: ref.trim() }]);
    }

    // kind === "local"
    if (ctx.options.mock) return emit([{ ...MOCK_LOCAL_ROW }]);

    const dir = isAbsolute(ref) ? ref : resolve(ctx.options.baseDir, ref);
    if (!existsSync(dir)) {
      throw new Error(`commands.repoRowSynthesize: local repo '${dir}' does not exist`);
    }
    if (!existsSync(join(dir, ".git"))) {
      throw new Error(`commands.repoRowSynthesize: local repo '${dir}' is not a git repository (no .git/)`);
    }

    let repo_url = null;
    let clone_url = null;
    try {
      // ARGV LIST — never an interpolated command string (security rule 4).
      const { stdout } = await execFileAsync("git", ["-C", dir, "remote", "get-url", "origin"], {
        timeout: params.timeout_ms ?? 15000,
      });
      const origin = stdout.trim();
      repo_url = normalizeRepoUrl(origin);
      // Preserve origin's transport (ssh vs https) for the clone — see header.
      if (repo_url !== null) clone_url = origin;
      if (repo_url === null) {
        diagnostics.push(`commands.repoRowSynthesize: origin of '${dir}' ('${origin}') is not a canonical repo URL — collect_repos will drop this row`);
      }
    } catch (err) {
      diagnostics.push(`commands.repoRowSynthesize: '${dir}' has no usable 'origin' remote (${err.message.trim()}) — collect_repos will drop this row`);
    }

    const repo = repo_url ? ownerSlug(repo_url) : basename(dir);
    return emit([{ repo, repo_url, clone_url }]);
  };
}
