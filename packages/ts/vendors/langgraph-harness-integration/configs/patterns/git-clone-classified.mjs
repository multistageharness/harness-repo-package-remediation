/**
 * commands.gitCloneClassified — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): integration-side
 * replacement for the vendored `commands.gitClone` (the mirror atom at
 * harness-repo-package-remediation/vendors/langgraph-harness/sdk/src/atoms/commands/git-clone.mjs is a
 * pristine reference and is never edited — record 0019/A1, Epic 01).
 *
 * Identical happy paths to the mirror — mock, existed, and success shapes are
 * byte-for-byte the same (same slugFromUrl derivation) — plus the fourth
 * `failed: true` result shape: a real clone failure is caught, classified via
 * `classifyCloneError` (src/clone-errors.mjs), retried bounded when transient
 * (max_attempts, default 3 — the platform's bounded-loop convention), and
 * RECORDED AS DATA `{ dir, url, cloned: false, failed: true, errorClass,
 * errorDetail, attempts }` instead of thrown — so one bad repo URL can never
 * abort a whole fan-out branch. auth_required / not_found / unknown never
 * retry (fail on attempt 1).
 *
 * KEY vs CLONE URL. The `url_from` channel carries either a bare canonical string
 * (legacy / hand-built state) or a `{ url, clone_url }` entry from
 * `commands.collectRepos`. `url` is the canonical https DEDUP KEY — it is what
 * names the on-disk slug and what every downstream stage joins on, so the clone
 * directory is stable no matter which transport was used. `clone_url` is the
 * reference the user actually supplied and is THE ONLY thing handed to `git
 * clone`: canonicalization rewrites `git@host:o/r.git` → `https://host/o/r`,
 * which silently drops SSH-key auth and makes a private repo answer `remote:
 * Repository not found`. Never clone the key.
 *
 * Subprocesses are argv lists via the SDK's runArgv (injection structurally
 * impossible — security rule 4); `_gitCloneClassifiedWith(runner)` is the
 * injection seam the unit test scripts a fake runner through.
 */

import { access } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { runArgv } from "../../src/sdk.mjs";
import { classifyCloneError } from "../../src/clone-errors.mjs";
import { normalizeRepoUrl } from "../../src/repo-url.mjs";

export const meta = {
  name: "commands.gitCloneClassified",
  category: "commands",
  summary: "git clone (argv-list, idempotent, mock-aware) of a {url, clone_url} entry, with classified, bounded-retry failure shapes — failures land as data, never thrown.",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      url: { type: "string" },
      url_from: { type: "string" },
      workspace: { type: "string" },
      depth: { type: "integer", minimum: 1 },
      on_exist: { enum: ["skip", "fail"] },
      into: { type: "string", minLength: 1 },
      max_attempts: { type: "integer", minimum: 1 },
    },
  },
  returns: "node",
};

// Local reimplementation of the mirror atom's slug derivation (the mirror's
// internals are not deep-imported — pristine boundary). Only ever fed the
// CANONICAL https url: an SCP-like `git@host:o/r.git` has no `/` before the
// owner, so slugging it directly would yield `git_host_o__r`.
function slugFromUrl(url) {
  const tail = url.replace(/\/+$/, "").split("/").slice(-2).join("/");
  return tail.replace(/\.git$/, "").replaceAll("/", "__").replace(/[^A-Za-z0-9_.-]/g, "_");
}

/**
 * Accept a `{url, clone_url}` entry or a bare string, and split it into the
 * canonical key (names the slug, joins downstream) and the clone target (the
 * transport as supplied). A bare string is both — normalized for the key, used
 * verbatim for the clone.
 * @returns {{url: string, cloneUrl: string}|null}
 */
function resolveTarget(value) {
  if (typeof value === "string" && value.length > 0) {
    return { url: normalizeRepoUrl(value) ?? value, cloneUrl: value };
  }
  if (value != null && typeof value === "object" && typeof value.url === "string" && value.url.length > 0) {
    const cloneUrl = typeof value.clone_url === "string" && value.clone_url.length > 0 ? value.clone_url : value.url;
    return { url: value.url, cloneUrl };
  }
  return null;
}

/** Test seam: build the factory over an injected argv runner. */
export function _gitCloneClassifiedWith(runner) {
  return function gitCloneClassifiedFactory(params, ctx) {
    return async (state) => {
      const target = resolveTarget(params.url_from ? state[params.url_from] : params.url);
      if (target === null) {
        throw new Error(`commands.gitCloneClassified: no url (url param or url_from channel '${params.url_from ?? ""}')`);
      }
      const { url, cloneUrl } = target;
      const workspaceRel = params.workspace ?? ".runs/workspace";
      const workspace = isAbsolute(workspaceRel) ? workspaceRel : resolve(ctx.options.baseDir, workspaceRel);
      const dir = join(workspace, slugFromUrl(url));

      if (ctx.options.mock) {
        return { [params.into]: { dir, url, cloned: false, mocked: true } };
      }

      const exists = await access(join(dir, ".git")).then(() => true, () => false);
      if (exists) {
        if ((params.on_exist ?? "skip") === "fail") throw new Error(`commands.gitCloneClassified: '${dir}' already exists`);
        return { [params.into]: { dir, url, cloned: false, existed: true } };
      }

      const argv = ["git", "clone", "--single-branch"];
      if (params.depth) argv.push("--depth", String(params.depth));
      // clone the SUPPLIED transport, never the canonical key — see header.
      argv.push(cloneUrl, dir);

      const maxAttempts = params.max_attempts ?? 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await runner(argv, { timeoutMs: 300000 });
          return { [params.into]: { dir, url, cloned: true } };
        } catch (err) {
          const errorClass = classifyCloneError(err);
          if (errorClass === "transient" && attempt < maxAttempts) continue;
          return {
            [params.into]: {
              dir,
              url,
              // what git was actually asked to fetch — the first thing you need
              // when an auth/not-found failure has to be reproduced by hand.
              clone_url: cloneUrl,
              cloned: false,
              failed: true,
              errorClass,
              errorDetail: String(err?.stderr ?? err?.message ?? "").slice(0, 500),
              attempts: attempt,
            },
          };
        }
      }
    };
  };
}

export const gitCloneClassified = _gitCloneClassifiedWith(runArgv);
