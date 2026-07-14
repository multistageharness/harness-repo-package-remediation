/**
 * @repo-snapshots/tool — dependency-free ESM repo filesystem-snapshot library.
 *
 * Given a cloned repo path, walk its tracked filesystem and emit the
 * `.snapshot.json` contract (change records 0008/D2 + 0009/D5):
 *
 *   {
 *     repo, root, namespace, generatedAt, fileCount,
 *     snapshot:   { <basename>: [ repo-relative path, ... ], ... },   // flat map (D2)
 *     collisions: { <basename>: { count, byDir, byExt }, ... }        // OPTIONAL (D5)
 *   }
 *
 * Phase namespace (change record 0029/A1): every snapshot self-identifies with
 * the run phase it was taken at — `initial` | `build` | `test` | … — an
 * open-ended label stamped as the top-level `namespace` field. Callers that
 * take a single snapshot per run may omit it; the tool defaults to `initial`,
 * so pre-0029 callers and goldens keep their value semantics.
 *
 * Enumeration source of truth (0009/D4): `git ls-files -z` semantics — tracked
 * files only, honoring `.gitignore`, so `node_modules/`, `.git/`, and build
 * output never enter the inventory. Invoked as an argv LIST via `execFile`
 * (never an interpolated shell string — security rule 4, injection is
 * structurally impossible) and NUL-delimited so filenames with spaces, newlines,
 * or unicode are parsed correctly. When the target is not a git working tree the
 * tool falls back to a filtered recursive `fs` walk that skips VCS/dep/build
 * dirs.
 *
 * Determinism (0008/D2): basename keys are sorted, every path array is sorted,
 * and `generatedAt` is stamped by the CALLER (passed in) — the library never
 * reads the clock — so a snapshot is byte-stable and diffable, and tests can
 * pin a fixed timestamp.
 *
 * Builtins only: `node:child_process` (execFile), `node:fs/promises`,
 * `node:path`, `node:util`. No external deps — matches the harness-repo-package-remediation/langgraph-langchain-harness
 * "hand-rolled, no deps" house style.
 */

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// Directories excluded by the fs-walk fallback (git ls-files honors .gitignore
// on its own, so this list only matters when the target is NOT a git tree).
const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".bzr",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "target",
  ".next",
  ".turbo",
  ".cache",
]);

/**
 * Enumerate the repo-relative, POSIX-separated file paths under `root`.
 *
 * Prefers `git ls-files -z` (tracked files, .gitignore honored). A non-git
 * working tree makes `git` exit non-zero → we fall back to a filtered fs walk.
 *
 * @param {string} root absolute (or cwd-relative) path to the repo working tree
 * @returns {Promise<{ source: "git" | "fs-walk", files: string[] }>}
 */
export async function enumerateFiles(root) {
  try {
    const { stdout } = await execFileP("git", ["-C", root, "ls-files", "-z"], {
      maxBuffer: 256 * 1024 * 1024,
    });
    // `-z` → NUL-delimited; drop the trailing empty segment after the last NUL.
    const files = stdout.split("\0").filter((p) => p.length > 0);
    return { source: "git", files: files.map(toPosix) };
  } catch {
    // Not a git working tree (or git unavailable) → filtered filesystem walk.
    const files = await walk(root, "");
    return { source: "fs-walk", files: files.sort() };
  }
}

/**
 * Build the `.snapshot.json` object for a repo (0008/D2 + 0009/D5).
 *
 * @param {object} args
 * @param {string} args.root       clone path (stored verbatim in the artifact)
 * @param {string} args.repo       repo slug used for the filename + `repo` field
 * @param {string} args.generatedAt ISO-8601 UTC stamp, supplied by the caller
 * @param {string} [args.namespace] run-phase label (`initial` | `build` | `test` | …); defaults to `initial` (0029/A1)
 * @returns {Promise<object>} the snapshot document
 */
export async function buildSnapshot({ root, repo, generatedAt, namespace }) {
  const { files } = await enumerateFiles(root);
  return shapeSnapshot({ root, repo, generatedAt, files, namespace });
}

/**
 * Pure snapshot shaper — group an already-enumerated file list by basename and
 * apply the determinism + collision-index rules. Separated from `buildSnapshot`
 * so it can be unit-tested with no subprocess/fs.
 *
 * @param {object} args
 * @param {string} args.root
 * @param {string} args.repo
 * @param {string} args.generatedAt
 * @param {string[]} args.files repo-relative POSIX paths
 * @param {string} [args.namespace] run-phase label; defaults to `initial` (0029/A1)
 * @returns {object}
 */
export function shapeSnapshot({ root, repo, generatedAt, files, namespace }) {
  const paths = [...new Set(files.map(toPosix))].sort();

  // FLATTENED BY BASENAME: <filename> -> sorted array of repo-relative paths.
  const byBasename = new Map();
  for (const p of paths) {
    const base = path.posix.basename(p);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(p);
  }

  const snapshot = {};
  const collisions = {};
  for (const base of [...byBasename.keys()].sort()) {
    const locations = byBasename.get(base).slice().sort();
    snapshot[base] = locations;

    // Fallback secondary index (0009/D5): ONLY for basenames that collide
    // (appear in >= 2 locations). Omitted entirely when nothing collides.
    if (locations.length >= 2) {
      collisions[base] = {
        count: locations.length,
        byDir: groupSorted(locations, (p) => path.posix.dirname(p)),
        byExt: groupSorted(locations, (p) => path.posix.extname(p)),
      };
    }
  }

  const doc = {
    repo,
    root,
    // 0029/A1: the phase axis — which point of the run this snapshot captures.
    namespace: typeof namespace === "string" && namespace.length > 0 ? namespace : "initial",
    generatedAt,
    fileCount: paths.length,
    snapshot,
  };
  if (Object.keys(collisions).length > 0) doc.collisions = collisions;
  return doc;
}

// Representative sample inventory for the mock stub (change record 0014/A1).
// A tiny, fixed file list that exercises the FULL `.snapshot.json` shape: a
// plain basename→[path], and a colliding basename (`package.json` in two dirs)
// so the emitted stub demonstrates both the flat map (0008/D2) and the
// collisions index (0009/D5). Fixed paths → deterministic, no clock, no fs.
const STUB_SAMPLE_FILES = [
  "README.md",
  "package.json",
  "packages/app/package.json",
  "src/index.mjs",
];

/**
 * Deterministic stub snapshot — no subprocess, no fs. Used by the mock seam
 * (mock run, mock-cloned entry, or a dir absent on disk) so the acceptance
 * contract stays offline: no network, no git, no filesystem read.
 *
 * Emits a small REPRESENTATIVE populated inventory (0014/A1) — not an empty
 * map — aligning with change record 0005's ruling that mock/stub artifacts must
 * demonstrate the real shape (populated setup/install/run/test manifests) rather
 * than a `{}` that hides the contract. Built through `shapeSnapshot` on the
 * fixed `STUB_SAMPLE_FILES` so the stub is byte-stable and schema-valid, with a
 * real `root`/`generatedAt` supplied by the caller.
 *
 * @param {object} args
 * @param {string} args.root
 * @param {string} args.repo
 * @param {string} args.generatedAt
 * @param {string} [args.namespace] run-phase label; defaults to `initial` (0029/A1)
 * @returns {object}
 */
export function stubSnapshot({ root, repo, generatedAt, namespace }) {
  return shapeSnapshot({ root, repo, generatedAt, files: STUB_SAMPLE_FILES, namespace });
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Normalize a path to POSIX separators (git already emits POSIX; walk may not). */
function toPosix(p) {
  return p.split(path.sep).join("/");
}

/**
 * Group `paths` by `keyOf(path)`, sorting both the group keys and each group's
 * path array — keeps the collision index byte-stable/diffable.
 */
function groupSorted(paths, keyOf) {
  const map = new Map();
  for (const p of paths) {
    const key = keyOf(p);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  const out = {};
  for (const key of [...map.keys()].sort()) out[key] = map.get(key).slice().sort();
  return out;
}

/**
 * Filtered recursive directory walk (fallback for non-git trees). Returns
 * repo-relative POSIX paths, skipping SKIP_DIRS. Symlinks are not followed
 * (readdir withFileTypes reports them as neither file nor dir here → ignored).
 */
async function walk(root, rel) {
  const abs = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walk(root, childRel)));
    } else if (entry.isFile()) {
      out.push(toPosix(childRel));
    }
  }
  return out;
}
