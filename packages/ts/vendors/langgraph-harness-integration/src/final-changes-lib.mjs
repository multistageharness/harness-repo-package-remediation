/**
 * src/final-changes-lib.mjs — the PURE core of the terminal `export_changes`
 * stage (langgraph-flow.md step 18¾): decide WHICH files a run changed in each
 * clone, and shape the two artifacts the stage writes — the per-repo
 * `repo-metadata.json` and the aggregate `manifest.json`.
 *
 * TWO EVIDENCE SOURCES, UNIONED — never one or the other:
 *
 *   1. **the git scan** — what actually changed on disk in the clone
 *      (`git status --porcelain`). This is the AUTHORITATIVE answer: it sees
 *      edits the records never mention (a lockfile a package manager rewrote,
 *      a transitive pin writer's second file), and it is what a human means by
 *      "what did this run change".
 *   2. **the recorded applied changes** — `remediations[]` where `applied` is
 *      true, each naming the manifest it edited. This is the INTENT: it
 *      survives when the scan cannot run (clone failed, git absent, a
 *      `--mock` run), and it is what lets a file be reported as
 *      `evidence: "recorded"` — claimed by the pipeline but NOT present on
 *      disk, which is a real finding, not a gap to paper over.
 *
 * A file's `evidence` field says which sources saw it (`git` | `recorded` |
 * `git+recorded`). The disagreement between the two IS the signal — a recorded
 * edit with no git evidence means the write silently did not land; a git change
 * with no record means something other than `remediate` touched the tree. The
 * lib records both and hides neither.
 *
 * BOUNDED (platform rule 4): the file set is capped (`maxFiles`) and each
 * file's copy is capped (`maxFileBytes`); every truncation is RECORDED, never
 * silent — a report that quietly dropped the 201st changed file would be worse
 * than one that says it stopped.
 *
 * EXCLUSIONS: the install/build stages write `node_modules/`, `.venv/`,
 * `target/`, `dist/` INTO the clone (the 0025/A2 hazard class), and steps 10/13
 * run BEFORE this stage. Those trees are machine output, not "what the run
 * changed" — `isExcludedPath` drops them, so this export stays the size of a
 * patch rather than the size of a dependency closure.
 *
 * Pure: no fs, no subprocess, no clock (`generatedAt` is stamped by the caller,
 * the snapshot.mjs discipline — so goldens stay pinnable). The atom
 * (`configs/patterns/export-applied-changes.mjs`) owns every side effect.
 */

/**
 * Directory names whose subtrees are machine output, never run changes.
 * Matched per PATH SEGMENT, so a nested `packages/a/node_modules` is caught as
 * surely as a root one.
 */
export const EXCLUDED_SEGMENTS = Object.freeze([
  ".git",
  "node_modules",
  ".venv",
  ".venv-deptry",
  "venv",
  "target",
  "dist",
  "build",
  ".gradle",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "htmlcov",
]);

/**
 * True when `relPath` lies inside a machine-output tree (or IS one). Also
 * catches python's `*.egg-info/` build metadata, which is named per package and
 * so cannot be a fixed segment.
 * @param {string} relPath repo-relative, `/`-separated
 * @returns {boolean}
 */
export function isExcludedPath(relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) return true;
  const segments = relPath.split("/").filter((s) => s.length > 0);
  return segments.some((seg) => EXCLUDED_SEGMENTS.includes(seg) || seg.endsWith(".egg-info"));
}

/**
 * A path is SAFE when it stays inside the repo it claims to belong to. Git only
 * ever prints repo-relative paths, but the recorded `manifest` / `pinnedIn`
 * fields are data that flowed in from the dataset — and this stage concatenates
 * them into a destination path. So the traversal guard runs on BOTH (the
 * filesystem analogue of security rule §4's argv discipline; the same reasoning
 * that made the session id a canonical-UUID-only grammar).
 * @param {string} relPath
 * @returns {boolean}
 */
export function isSafeRelPath(relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) return false;
  if (relPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(relPath)) return false;
  const segments = relPath.split(/[\\/]/);
  return !segments.some((seg) => seg === ".." || seg === "");
}

/** Map a porcelain XY status pair to the vocabulary the metadata reports. */
export function statusFromXY(xy) {
  const code = String(xy ?? "");
  if (code === "??") return "untracked";
  const flags = code.replace(/\s/g, "");
  if (flags.includes("D")) return "deleted";
  if (flags.includes("R")) return "renamed";
  if (flags.includes("A")) return "added";
  if (flags.includes("C")) return "copied";
  if (flags.includes("M")) return "modified";
  if (flags.includes("U")) return "conflicted";
  return "changed";
}

/**
 * Parse `git status --porcelain=v1 -z` output. NUL-separated records; a rename
 * or copy is TWO fields — `R  <new>` then the original path as its own field —
 * which is exactly why `-z` is used over the line-oriented form (a path with a
 * space or a quote cannot corrupt the parse).
 *
 * An untracked DIRECTORY arrives as a single `?? dir/` entry (git's default
 * `-unormal` collapse); it is returned with `isDir: true` and the caller
 * expands it with a bounded walk. Keeping the collapse is deliberate: `-uall`
 * against a clone that step 10 filled with `node_modules` would print tens of
 * thousands of paths only to have every one of them filtered out here.
 *
 * @param {string} text
 * @returns {Array<{status: string, path: string, from: string|null, isDir: boolean}>}
 */
export function parsePorcelain(text) {
  const fields = String(text ?? "").split("\0");
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i];
    if (!rec || rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    const rawPath = rec.slice(3);
    let from = null;
    // Rename/copy: git emits the ORIGINAL path as the very next NUL field.
    if (xy[0] === "R" || xy[0] === "C") {
      from = fields[i + 1] ?? null;
      i += 1;
    }
    const isDir = rawPath.endsWith("/");
    entries.push({
      status: statusFromXY(xy),
      path: isDir ? rawPath.slice(0, -1) : rawPath,
      from,
      isDir,
    });
  }
  return entries;
}

/**
 * The repo-relative files the RECORDS claim were edited: every applied
 * remediation's `manifest` / `pinnedIn`. Deduped, traversal-guarded, sorted.
 * @param {Array<Record<string, unknown>>} remediations already filtered to one repo
 * @returns {string[]}
 */
export function recordedFilesFor(remediations) {
  const out = new Set();
  for (const rem of remediations ?? []) {
    if (!rem?.applied) continue;
    for (const key of ["manifest", "pinnedIn", "file"]) {
      const value = rem?.[key];
      if (typeof value !== "string" || value.length === 0) continue;
      const rel = value.replace(/\\/g, "/").replace(/^\.\//, "");
      if (isSafeRelPath(rel) && !isExcludedPath(rel)) out.add(rel);
    }
  }
  return [...out].sort();
}

/**
 * Union the two evidence sources into ONE ordered file ledger. Git wins on
 * `status` (it observed the disk); a recorded-only file is carried with
 * `status: "recorded-only"` so the disagreement stays visible.
 *
 * @param {{gitEntries?: Array<{status: string, path: string, from: string|null}>, recordedPaths?: string[], maxFiles?: number}} input
 * @returns {{files: Array<{path: string, status: string, evidence: string, from: string|null}>, truncated: number}}
 */
export function unionChangedFiles({ gitEntries = [], recordedPaths = [], maxFiles = 200 } = {}) {
  const byPath = new Map();
  for (const entry of gitEntries) {
    const rel = String(entry?.path ?? "").replace(/\\/g, "/");
    if (!isSafeRelPath(rel) || isExcludedPath(rel)) continue;
    byPath.set(rel, { path: rel, status: entry.status, evidence: "git", from: entry.from ?? null });
  }
  for (const rel of recordedPaths) {
    const existing = byPath.get(rel);
    if (existing) existing.evidence = "git+recorded";
    // A recorded edit git cannot see: the write did not land (or the scan could
    // not run). Either way it is reported, never dropped.
    else byPath.set(rel, { path: rel, status: "recorded-only", evidence: "recorded", from: null });
  }
  const all = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files = all.slice(0, Math.max(0, maxFiles));
  return { files, truncated: all.length - files.length };
}

/** Deterministic clone-dir slug → the per-repo directory name under the export root. */
export function repoSlugFor({ dir, url, repo } = {}) {
  const fromDir = typeof dir === "string" && dir.length > 0 ? dir.split(/[\\/]/).filter(Boolean).pop() : null;
  if (fromDir) return fromDir;
  const source = typeof url === "string" && url.length > 0 ? url : typeof repo === "string" ? repo : "";
  const cleaned = source
    .replace(/^https?:\/\//i, "")
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "__")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "unknown-repo";
}

/**
 * Shape one repo's `repo-metadata.json`. Pure — the atom hands in what it read
 * (git facts, the copied-file ledger) and the channels it sliced per repo.
 */
export function buildRepoMetadata({
  slug,
  url,
  dir,
  ecosystem = null,
  git = null,
  files = [],
  remediations = [],
  validation = null,
  changelogs = [],
  plan = null,
  truncated = 0,
  status = "ok",
  notes = [],
  generatedAt,
  mock = false,
} = {}) {
  const applied = (remediations ?? [])
    .filter((r) => r?.applied)
    .map((r) => ({
      package: r.package ?? null,
      from: r.from ?? null,
      to: r.to ?? null,
      source: r.source ?? null,
      strategy: r.strategy ?? null,
      tool: r.tool ?? null,
      manifest: r.manifest ?? null,
      pinnedIn: r.pinnedIn ?? null,
      planned: r.planned === true,
    }))
    .sort((a, b) => String(a.package).localeCompare(String(b.package)));
  const skipped = (remediations ?? [])
    .filter((r) => r && !r.applied)
    .map((r) => ({ package: r.package ?? null, to: r.to ?? null, skipReason: r.skipReason ?? null }))
    .sort((a, b) => String(a.package).localeCompare(String(b.package)));

  const copied = files.filter((f) => f.copiedTo).length;
  return {
    schema: "final-applied-changes/v1",
    generatedAt,
    mock,
    status,
    repo: {
      name: slug,
      url: url ?? null,
      dir: dir ?? null,
      ecosystem,
      commit: git?.commit ?? null,
      branch: git?.branch ?? null,
      dirty: files.some((f) => f.evidence !== "recorded"),
    },
    // WHERE the ledger below came from — a reader must never have to guess
    // whether "no changes" means "the run changed nothing" or "the scan could
    // not run" (the 0051/A3 absent≠skipped discipline, one stage later).
    evidence: {
      git: git?.available === true,
      gitError: git?.error ?? null,
      recorded: applied.length > 0,
      source: git?.available ? (applied.length > 0 ? "git+recorded" : "git") : applied.length > 0 ? "recorded" : "none",
      patch: git?.patchWritten ? "changes.patch" : null,
      note: git?.available
        ? "changes/ holds the COMPLETE post-remediation file; original/ holds its HEAD baseline."
        : "no git scan — the ledger below is the pipeline's recorded intent, not observed disk state.",
    },
    applied,
    skipped,
    outcomes: validation?.outcomes ?? null,
    validation: validation
      ? { overall: validation.overall ?? null, stages: validation.stages ?? null, packages: validation.packages ?? [] }
      : null,
    changelogs: changelogs ?? [],
    plan: plan ? { actions: plan.actions ?? [], skill: plan.skill ?? null, tools: plan.tools ?? [] } : null,
    files,
    totals: {
      changed: files.length,
      copied,
      appliedRemediations: applied.length,
      truncatedFiles: truncated,
    },
    notes,
  };
}

/** Shape the aggregate `manifest.json` — the index a human (or the next stage) opens first. */
export function buildManifest({ sessionId = null, repos = [], generatedAt, mock = false } = {}) {
  const sorted = [...repos].sort((a, b) => String(a.repo?.name).localeCompare(String(b.repo?.name)));
  const totals = sorted.reduce(
    (acc, r) => ({
      repos: acc.repos + 1,
      reposWithChanges: acc.reposWithChanges + (r.totals.changed > 0 ? 1 : 0),
      files: acc.files + r.totals.changed,
      copied: acc.copied + r.totals.copied,
      appliedRemediations: acc.appliedRemediations + r.totals.appliedRemediations,
    }),
    { repos: 0, reposWithChanges: 0, files: 0, copied: 0, appliedRemediations: 0 },
  );
  return {
    schema: "final-applied-changes/v1",
    generatedAt,
    mock,
    sessionId,
    totals,
    repos: sorted.map((r) => ({
      name: r.repo.name,
      url: r.repo.url,
      dir: r.repo.dir,
      ecosystem: r.repo.ecosystem,
      status: r.status,
      evidence: r.evidence.source,
      changed: r.totals.changed,
      copied: r.totals.copied,
      appliedRemediations: r.totals.appliedRemediations,
      outcomes: r.outcomes,
      metadata: `${r.repo.name}/repo-metadata.json`,
    })),
  };
}
