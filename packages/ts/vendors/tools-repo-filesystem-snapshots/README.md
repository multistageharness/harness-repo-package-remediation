# tools-repo-filesystem-snapshots

A dependency-light vendor tool that, given a cloned repo path, walks its tracked
filesystem and emits a per-repo **filesystem snapshot** — a `filename → paths`
inventory written to `.harness/repo-snapshots/<repo>.snapshot.json`.

It complements the sibling [`repository-fingerprint`](../repository-fingerprint/)
tool: fingerprint detects **ecosystems/signals**, this tool produces a full
**file inventory** ("where is every `package.json` / `Dockerfile` / lockfile in
this repo?"). Change records `0008` (package + flat-map contract) and `0009`
(new flow, mjs-only impl, collision fallback index) under
[`repo-remediation-pipeline-…/changelogs/`](../../../.ai/agile/).

## Layout

```
tools-repo-filesystem-snapshots/
  packages/mjs/index.mjs        primary Node ESM implementation (builtins only)
  packages/mjs/test/            node:test unit tests
  schema/snapshot.schema.json   the .snapshot.json output contract (JSON Schema)
  fixtures/sample-repo/         a small monorepo tree with basename collisions
  fixtures/sample-repo.expected.json  the golden snapshot for that tree
```

The **bash / powershell twins** are deferred (record `0009`/D4) — mjs was picked
as the single implementation because the pipeline imports it **in-process** at
the langgraph seam (no per-repo subprocess spawn), parses `git ls-files -z`
NUL-delimited output accurately, and calls `git` as a fixed **argv list** so
shell injection is structurally impossible.

## Enumeration source of truth

1. **`git ls-files -z`** (preferred) — **tracked files only, honoring
   `.gitignore`**, so `node_modules/`, `.git/`, and build output never enter the
   inventory. NUL-delimited (`-z`) so filenames with spaces/newlines/unicode are
   parsed correctly. Invoked as `git -C <root> ls-files -z` via `execFile` with
   an argv array — never an interpolated shell string.
2. **Filtered `fs` walk** (fallback) — used when the target is **not a git
   working tree** (git exits non-zero). Recurses the tree skipping VCS/dependency/
   build dirs (`.git`, `node_modules`, `dist`, `build`, `target`, …).

## Determinism

Basename keys are **sorted**, every path array is **sorted**, paths are
**repo-relative** and **POSIX-separated**, and `generatedAt` is stamped by the
**caller** (the library never reads the clock). Snapshots are therefore
byte-stable and diffable, and tests can pin a fixed timestamp.

## Output contract — `<repo>.snapshot.json`

```jsonc
{
  "repo": "<repo name>",            // slug used for the filename
  "root": "<clone path>",           // the path the snapshot was taken from
  "generatedAt": "<ISO-8601 UTC>",  // stamped by the caller, not the library
  "fileCount": 7,                   // total distinct path entries
  "snapshot": {                     // FLATTENED BY BASENAME: <filename> -> [paths]
    "Dockerfile":   ["Dockerfile", "services/api/Dockerfile"],
    "package.json": ["package.json", "packages/mjs/package.json", "server/package.json"],
    "index.mjs":    ["src/index.mjs"]
  },
  "collisions": {                   // OPTIONAL — present only when a basename collides
    "package.json": {
      "count": 3,
      "byDir": { ".": ["package.json"], "packages/mjs": ["packages/mjs/package.json"], "server": ["server/package.json"] },
      "byExt": { ".json": ["package.json", "packages/mjs/package.json", "server/package.json"] }
    }
  }
}
```

- **Key = basename**, **value = `Array<string>`** of repo-relative paths where a
  file with that basename lives.
- **`collisions`** (record `0009`/D5) is a **fallback secondary index** emitted
  **only for basenames that appear in ≥2 locations**; it is omitted entirely
  when nothing collides. A consumer resolves by basename against `snapshot`
  first, and falls back to `collisions[basename].byDir` / `.byExt` to
  disambiguate an ambiguous (>1 path) result.

Full schema: [`schema/snapshot.schema.json`](schema/snapshot.schema.json).

## API

```js
import { buildSnapshot, shapeSnapshot, stubSnapshot, enumerateFiles }
  from "./packages/mjs/index.mjs";

// walk a clone and shape the snapshot (spawns the fixed-argv git call)
const doc = await buildSnapshot({ root, repo, generatedAt: new Date().toISOString() });

// pure shaper over an already-enumerated file list (no subprocess/fs)
const doc2 = shapeSnapshot({ root, repo, generatedAt, files });

// deterministic offline stub (mock seam — no git, no fs, no network).
// Returns a small REPRESENTATIVE populated inventory (0014/A1) — a plain
// basename plus a colliding one — so the mock artifact demonstrates the real
// `.snapshot.json` shape (map + collision index) instead of an empty `{}`.
const stub = stubSnapshot({ root, repo, generatedAt });
```

## Wiring

The langgraph integration pack bridges this library through
`langgraph-harness-integration/src/snapshot-lib.mjs` and drives it from the
`commands.repoSnapshot` pattern in a **separate snapshot flow**
(`configs/flows/repo-snapshot.yaml`) — the frozen `repo-remediation.yaml` step
chain is untouched (record `0009`/D3).

## Test

```sh
node --test packages/mjs/test/*.test.mjs
```

Offline — the only subprocess is the fixed-argv `git ls-files` call.
