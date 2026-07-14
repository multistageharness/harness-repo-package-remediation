/**
 * commands.exportAppliedChanges — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the FINAL CONTENT stage
 * (`langgraph-flow.md` step 18¾, node `export_changes`). After the reports are
 * rendered, collect what the run actually CHANGED in every clone and copy the
 * COMPLETE changed files out of the disposable clone tree into a durable,
 * self-describing export:
 *
 *   <session>/final_applied_changes/
 *     manifest.json                       ← the aggregate index (every repo)
 *     <repo>/
 *       repo-metadata.json                ← identity, applied edits, outcomes, file ledger
 *       changes/<repo/relative/path>      ← the COMPLETE post-remediation file
 *       original/<repo/relative/path>     ← its HEAD baseline (diff without git)
 *       changes.patch                     ← `git diff HEAD`, when the scan ran
 *
 * WHY THIS EXISTS: every artifact before it is a DESCRIPTION of the change —
 * `remediations[]` says a bump was applied, the reports say it was `fixed`. The
 * changed BYTES live only in `<session>/repos/<slug>`, a tree the next run's
 * clone stage may skip, resume over, or (with a fresh session id) never write
 * again. This stage is what makes the run's product survive the run.
 *
 * TWO EVIDENCE SOURCES, UNIONED (`src/final-changes-lib.mjs`): the git scan of
 * each clone (authoritative — it sees the lockfile a package manager rewrote and
 * the second file a transitive-pin writer touched, neither of which any record
 * names) UNIONED with the recorded applied `remediations[]` (intent — it
 * survives a failed clone, an absent git, a `--mock` run). Their DISAGREEMENT is
 * the signal and is reported, never smoothed: a recorded edit with no git
 * evidence lands as `evidence: "recorded"`, `status: "recorded-only"` — the
 * write did not land — and a git change no record claims lands as
 * `evidence: "git"`.
 *
 * NON-GATING (the install-verify/errors discipline, 0027/A1): a repo whose scan
 * explodes is a RECORDED `status: "failed"` entry with its error; every other
 * repo still exports, and the stage NEVER throws. It runs before the terminal
 * `errors` node precisely so a failure here still reaches errors.logs.
 *
 * BOUNDED (platform rule 4): `max_files` per repo (default 200) and
 * `max_file_bytes` per file (default 2 MiB) — every truncation RECORDED. The
 * git children are argv lists with bounded timeouts and a bounded maxBuffer
 * (security rule §4: no interpolated command strings, injection structurally
 * impossible — a repo-relative path from `git status` is DATA, and it passes a
 * traversal guard before it is ever concatenated into a destination path).
 *
 * EXCLUSIONS: steps 10/13 (install, build) run BEFORE this stage and write
 * `node_modules/`, `.venv/`, `target/`, `dist/` INTO the clone (the 0025/A2
 * hazard class). Those are machine output, not run changes — `isExcludedPath`
 * drops them, so this export stays the size of a patch, not of a dependency
 * closure.
 *
 * Mock seam (offline acceptance contract): under `ctx.options.mock` — or per
 * entry, for a clone the stage marked `mocked`/`failed` — NO git subprocess and
 * NO repo read. The artifacts are still WRITTEN (they ARE the deliverable, the
 * remediation_report/html_report rule), carrying the recorded intent plus an
 * explicit `evidence.source` so a mock export can never be mistaken for an
 * observed one. Honors `ctx.options.dryRun` (computes the ledger, skips writes).
 *
 * Trust boundary: lives under `configs/patterns/`; imports only the pack's own
 * `src/` bridges (`final-changes-lib.mjs`, `sdk.mjs`). No provider SDK, no
 * credentials, no network.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  buildManifest,
  buildRepoMetadata,
  isExcludedPath,
  isSafeRelPath,
  parsePorcelain,
  recordedFilesFor,
  repoSlugFor,
  unionChangedFiles,
} from "../../src/final-changes-lib.mjs";
import { writeFileAtomic } from "../../src/sdk.mjs";

const execFileAsync = promisify(execFile);

export const meta = {
  name: "commands.exportAppliedChanges",
  category: "commands",
  summary:
    "Final content stage: scan each clone for changes (git) UNIONED with the recorded applied remediations, and copy the complete changed files + per-repo metadata into <session>/final_applied_changes/<repo>/. Bounded, non-gating, mock-aware.",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      // Channel the export summary is written into.
      into: { type: "string", minLength: 1 },
      // Channels sliced per repo. Defaults name the committed spine.
      clones_from: { type: "string", minLength: 1 },
      remediations_from: { type: "string", minLength: 1 },
      validations_from: { type: "string", minLength: 1 },
      changelogs_from: { type: "string", minLength: 1 },
      fingerprints_from: { type: "string", minLength: 1 },
      plans_from: { type: "string", minLength: 1 },
      // Export root. Supplied by the render seam (outputStep/flow-plan → the
      // OVERLAYS allowlist); the internal default answers only a bare
      // committed-yaml run, matching fingerprint_report's rooting so the
      // directory stays a SIBLING of fingerprints.json in every topology.
      out_dir: { type: "string", minLength: 1 },
      // Bounds — every truncation is recorded (platform rule 4).
      max_files: { type: "integer", minimum: 1 },
      max_file_bytes: { type: "integer", minimum: 1 },
      timeout_ms: { type: "integer", minimum: 1 },
    },
  },
  returns: "node",
};

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
/** `git status` on a clone step 10 filled with node_modules can still be chatty. */
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
/** An untracked directory is expanded, but never into a second dependency closure. */
const WALK_MAX_ENTRIES = 2000;

/** Slice a channel array down to one repo. Records key repos by url (`repo`) or by clone `dir`. */
function forRepo(list, { url, dir }) {
  return (Array.isArray(list) ? list : []).filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (url && (entry.repo === url || entry.url === url)) return true;
    if (dir && entry.dir === dir) return true;
    return false;
  });
}

/** Bounded expansion of an untracked directory git collapsed into one `?? dir/` entry. */
async function walkUntracked(rootDir, relDir, { readdirFn, budget }) {
  const found = [];
  const queue = [relDir];
  while (queue.length > 0 && found.length < budget.remaining) {
    const current = queue.shift();
    if (isExcludedPath(current)) continue;
    let entries;
    try {
      entries = await readdirFn(join(rootDir, current), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = `${current}/${entry.name}`;
      if (isExcludedPath(rel)) continue;
      if (entry.isDirectory()) queue.push(rel);
      else if (entry.isFile()) {
        found.push(rel);
        if (found.length >= budget.remaining) break;
      }
    }
  }
  return found;
}

/** Test seam: injected exec + fs so the unit tests drive the whole stage without a disk or a git. */
export function _exportAppliedChangesWith({
  exec = execFileAsync,
  read = readFile,
  write = writeFileAtomic,
  writeRaw = writeFile,
  ensureDir = (d) => mkdir(d, { recursive: true }),
  statFn = stat,
  readdirFn = readdir,
} = {}) {
  return function exportAppliedChangesFactory(params, ctx) {
    return async (state) => {
      const maxFiles = Number.isInteger(params.max_files) ? params.max_files : DEFAULT_MAX_FILES;
      const maxFileBytes = Number.isInteger(params.max_file_bytes) ? params.max_file_bytes : DEFAULT_MAX_FILE_BYTES;
      const timeout = Number.isInteger(params.timeout_ms) ? params.timeout_ms : DEFAULT_TIMEOUT_MS;
      const mock = ctx?.options?.mock === true;
      const dryRun = ctx?.options?.dryRun === true;

      const outDirParam = typeof params.out_dir === "string" && params.out_dir.length > 0 ? params.out_dir : "../../.harness/final_applied_changes";
      const exportRoot = isAbsolute(outDirParam) ? outDirParam : resolve(ctx.options.baseDir, outDirParam);
      // The session root is the export root's parent — that is what the clone
      // dirs below are made relative to, so no absolute host path reaches the
      // metadata (root CLAUDE.md; the errors-consolidate precedent).
      const sessionRoot = dirname(exportRoot);
      const sessionId = sessionRoot.split(/[\\/]/).filter(Boolean).pop() ?? null;
      // Stamped ONCE by the caller, never inside the lib (snapshot.mjs's
      // determinism discipline) — one timestamp for the whole export.
      const generatedAt = new Date().toISOString();

      const clones = Array.isArray(state?.[params.clones_from ?? "clone_results"]) ? state[params.clones_from ?? "clone_results"] : [];
      const allRemediations = state?.[params.remediations_from ?? "remediations"] ?? [];
      const allValidations = state?.[params.validations_from ?? "validations"] ?? [];
      const allChangelogs = state?.[params.changelogs_from ?? "changelogs"] ?? [];
      const allFingerprints = state?.[params.fingerprints_from ?? "fingerprints"] ?? [];
      const allPlans = state?.[params.plans_from ?? "plans"] ?? [];

      const metadatas = [];

      try {
        for (const clone of clones) {
          const url = clone?.url ?? clone?.repo ?? null;
          const dir = typeof clone?.dir === "string" && clone.dir.length > 0 ? clone.dir : null;
          const slug = repoSlugFor({ dir, url });
          const repoRoot = resolve(exportRoot, slug);

          const remediations = forRepo(allRemediations, { url, dir });
          const validation = forRepo(allValidations, { url, dir })[0] ?? null;
          const changelogs = forRepo(allChangelogs, { url, dir });
          const fingerprint = forRepo(allFingerprints, { url, dir })[0] ?? null;
          const plan = forRepo(allPlans, { url, dir })[0] ?? null;
          const ecosystem = fingerprint?.dominantEcosystem ?? validation?.ecosystem ?? plan?.ecosystem ?? null;
          const dirRel = dir ? relative(sessionRoot, dir) : null;

          // ── The no-scan lanes: mock, a mocked clone, a failed clone, no dir.
          // Each still EXPORTS (the artifact is the deliverable) but says plainly
          // that its ledger is recorded intent, not observed disk state.
          const skipReason = mock
            ? "mock run — no git scan, no repo read"
            : clone?.mocked
              ? "clone was a mock stub"
              : clone?.failed
                ? `clone failed (${clone.errorClass ?? "unknown"}) — nothing on disk to scan`
                : !dir
                  ? "clone recorded no directory"
                  : null;

          if (skipReason) {
            const recorded = recordedFilesFor(remediations);
            const { files } = unionChangedFiles({ gitEntries: [], recordedPaths: recorded, maxFiles });
            const meta = buildRepoMetadata({
              slug,
              url,
              dir: dirRel,
              ecosystem,
              git: { available: false, error: null, patchWritten: false },
              files: files.map((f) => ({ ...f, bytes: null, sha256: null, copiedTo: null, originalTo: null, note: skipReason })),
              remediations,
              validation,
              changelogs,
              plan,
              status: mock || clone?.mocked ? "mock" : "skipped",
              notes: [skipReason],
              generatedAt,
              mock: mock || clone?.mocked === true,
            });
            metadatas.push(meta);
            if (!dryRun) {
              await ensureDir(repoRoot);
              await write(resolve(repoRoot, "repo-metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
            }
            continue;
          }

          // ── The real lane: scan the clone, union, copy.
          try {
            const git = async (args) => {
              const { stdout } = await exec("git", ["-C", dir, ...args], { timeout, maxBuffer: GIT_MAX_BUFFER, encoding: "utf8" });
              return String(stdout ?? "");
            };
            const commit = (await git(["rev-parse", "HEAD"]).catch(() => "")).trim() || null;
            const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim() || null;
            const porcelain = await git(["status", "--porcelain=v1", "-z"]);

            const entries = parsePorcelain(porcelain);
            const gitEntries = [];
            for (const entry of entries) {
              if (isExcludedPath(entry.path)) continue;
              if (!entry.isDir) {
                gitEntries.push(entry);
                continue;
              }
              // An untracked directory: expand it, bounded, excluding machine output.
              const expanded = await walkUntracked(dir, entry.path, { readdirFn, budget: { remaining: WALK_MAX_ENTRIES } });
              for (const rel of expanded) gitEntries.push({ status: "untracked", path: rel, from: null });
            }

            const { files: ledger, truncated } = unionChangedFiles({
              gitEntries,
              recordedPaths: recordedFilesFor(remediations),
              maxFiles,
            });

            // The patch is a convenience view of the SAME facts — tracked files
            // only, so the ledger (which includes untracked ones) stays the
            // authority. An empty diff writes no file.
            const patch = await git(["diff", "HEAD"]).catch(() => "");
            const patchWritten = patch.trim().length > 0;

            const files = [];
            for (const entry of ledger) {
              const record = { ...entry, bytes: null, sha256: null, copiedTo: null, originalTo: null, note: null };
              // Guarded again at the WRITE boundary: the destination must stay
              // inside this repo's export dir even if a path slipped the union.
              if (!isSafeRelPath(entry.path)) {
                record.note = "unsafe path — not copied";
                files.push(record);
                continue;
              }
              const src = resolve(dir, entry.path);

              // The AFTER state: the complete changed file. A deleted file has
              // none (its baseline still lands in original/), and a recorded-only
              // file has none by definition — the write never landed.
              if (entry.status !== "deleted" && entry.status !== "recorded-only") {
                try {
                  const info = await statFn(src);
                  record.bytes = info.size;
                  if (info.size > maxFileBytes) {
                    record.note = `not copied — ${info.size} bytes exceeds max_file_bytes (${maxFileBytes})`;
                  } else {
                    const buf = await read(src);
                    record.sha256 = createHash("sha256").update(buf).digest("hex");
                    const dest = resolve(repoRoot, "changes", entry.path);
                    if (!dryRun) {
                      await ensureDir(dirname(dest));
                      await writeRaw(dest, buf);
                    }
                    record.copiedTo = `changes/${entry.path}`;
                  }
                } catch (err) {
                  record.note = `not copied — ${err?.message ?? err}`;
                }
              } else if (entry.status === "recorded-only") {
                record.note = "recorded as applied, but the git scan does not see it — the edit did not land on disk";
              }

              // The BEFORE state, straight from HEAD — so the export can be
              // diffed by someone who never had the clone.
              if (entry.status !== "untracked" && entry.status !== "added" && entry.status !== "recorded-only") {
                try {
                  const { stdout } = await exec("git", ["-C", dir, "show", `HEAD:${entry.from ?? entry.path}`], {
                    timeout,
                    maxBuffer: GIT_MAX_BUFFER,
                    encoding: "buffer",
                  });
                  const dest = resolve(repoRoot, "original", entry.path);
                  if (!dryRun) {
                    await ensureDir(dirname(dest));
                    await writeRaw(dest, stdout);
                  }
                  record.originalTo = `original/${entry.path}`;
                } catch {
                  // Not in HEAD (a file the run created and git already staged):
                  // there is no baseline, which is itself accurate.
                }
              }
              files.push(record);
            }

            const meta = buildRepoMetadata({
              slug,
              url,
              dir: dirRel,
              ecosystem,
              git: { available: true, error: null, commit, branch, patchWritten: patchWritten && !dryRun },
              files,
              remediations,
              validation,
              changelogs,
              plan,
              truncated,
              status: "ok",
              notes: truncated > 0 ? [`file ledger truncated at max_files=${maxFiles}; ${truncated} more changed file(s) not exported`] : [],
              generatedAt,
              mock: false,
            });
            metadatas.push(meta);

            if (!dryRun) {
              await ensureDir(repoRoot);
              if (patchWritten) await writeRaw(resolve(repoRoot, "changes.patch"), patch, "utf8");
              await write(resolve(repoRoot, "repo-metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
            }
          } catch (err) {
            // NON-GATING, per repo: one unreadable clone never costs the other nine.
            const meta = buildRepoMetadata({
              slug,
              url,
              dir: dirRel,
              ecosystem,
              git: { available: false, error: String(err?.message ?? err), patchWritten: false },
              files: [],
              remediations,
              validation,
              changelogs,
              plan,
              status: "failed",
              notes: [`export failed: ${err?.message ?? err}`],
              generatedAt,
              mock: false,
            });
            metadatas.push(meta);
            if (!dryRun) {
              await ensureDir(repoRoot).catch(() => {});
              await write(resolve(repoRoot, "repo-metadata.json"), `${JSON.stringify(meta, null, 2)}\n`).catch(() => {});
            }
          }
        }

        const manifest = buildManifest({ sessionId, repos: metadatas, generatedAt, mock });
        const manifestPath = resolve(exportRoot, "manifest.json");
        if (!dryRun) {
          await ensureDir(exportRoot);
          await write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        }

        return {
          [params.into]: {
            placeholder: false,
            ok: true,
            written: !dryRun,
            path: exportRoot,
            manifest: manifestPath,
            totals: manifest.totals,
            repos: manifest.repos,
          },
        };
      } catch (err) {
        // NON-GATING, whole-stage: the run's reports are already written; an
        // export that cannot run says so and returns.
        return {
          [params.into]: {
            placeholder: false,
            ok: false,
            written: false,
            path: exportRoot,
            error: String(err?.message ?? err),
            totals: { repos: 0, reposWithChanges: 0, files: 0, copied: 0, appliedRemediations: 0 },
            repos: [],
          },
        };
      }
    };
  };
}

export const exportAppliedChanges = _exportAppliedChangesWith({});
