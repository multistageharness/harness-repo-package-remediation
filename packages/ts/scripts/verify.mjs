#!/usr/bin/env node
// Offline verify gate: lint (if available) then run every package's node:test files.
// Zero extra runtime deps; subprocesses are spawned with argv arrays (never interpolated
// command strings) per the toolkit's security rules.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Recursively collect `*.test.mjs` files under a directory. */
function collectTests(dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTests(full, acc);
    } else if (entry.endsWith('.test.mjs')) {
      acc.push(full);
    }
  }
  return acc;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  return res.status ?? 1;
}

// 1) Lint first when ESLint is installed; a lint failure fails the gate.
const eslintBin = join(root, 'node_modules', '.bin', 'eslint');
if (existsSync(eslintBin)) {
  const lintStatus = run(eslintBin, ['.']);
  if (lintStatus !== 0) process.exit(lintStatus);
}

// 1b) Biome lints the same file set (see biome.json) as a second gate alongside ESLint;
// like ESLint above, it only runs when installed so the gate stays offline-friendly.
const biomeBin = join(root, 'node_modules', '.bin', 'biome');
if (existsSync(biomeBin)) {
  const biomeStatus = run(biomeBin, ['lint', '.']);
  if (biomeStatus !== 0) process.exit(biomeStatus);
}

// 1c) The React report package (record 0057/A7) is gated by DELEGATION to its own toolchain.
//
// It is not an npm workspace member and must never become one: its ~325 build-time dependencies
// would then be installable from — and resolvable by — the dependency-free generator, which is the
// one invariant that makes the committed-bundle design legal (record 0057/F1). It also cannot join
// `VENDOR_TEST_WORKSPACES` below, because that path feeds files to `node --test`, which cannot
// execute `.tsx`. So the gate shells out to the package's own `typecheck` + `test` scripts instead.
//
// It IS gated, rather than skipped like the pristine mirrors, because it is load-bearing production
// source: its Vite bundle ships inside `repo-remediation.html`. Until record 0057 it was untracked
// by git and covered by no gate at all — exactly the "work that looks verified while the evidence is
// absent" failure class record 0051 caught.
//
// Absent `node_modules` SKIPS rather than fails, for the same reason eslint/biome above are
// conditional: the gate must stay runnable offline with nothing installed.
// The `build:bundle -- --check` rung is record 0057/D1's STALENESS GATE. The React bundle that
// ships inside every report is a COMMITTED artifact — that is what lets the generator stay
// dependency-free and render offline — and the cost of committing generated output is that it can
// silently go stale. The check rebuilds, compares, writes nothing, and fails when the committed
// bundle no longer matches `reactjs/src/report/`. Without it, editing a React component and
// forgetting to rebuild would ship a report that does not reflect the source, and every test would
// still be green.
// `check:report` closes the last link. The staleness gate proves BUNDLE matches SOURCE; it says
// nothing about the reports already written to `.harness`, which carry their own copy of the bundle
// baked in. A page emitted before a CSS change keeps painting itself with the old stylesheet, and
// until this rung existed nothing compared the two — every "the static report doesn't match the dev
// server" bug reported so far was exactly that, and passed the gate green.
const reactReportDir = join(root, 'vendors', 'langgraph-repo-remediation-html-report-reactjs');
if (existsSync(join(reactReportDir, 'node_modules'))) {
  for (const args of [
    ['run', 'typecheck'],
    ['run', 'test'],
    ['run', 'build:bundle', '--', '--check'],
    ['run', 'check:report'],
  ]) {
    const status = run('npm', ['--prefix', reactReportDir, ...args]);
    if (status !== 0) process.exit(status);
  }
} else {
  console.log('verify: react report package has no node_modules — skipping its toolchain (offline).');
}

// 2) Run all workspace tests in a single node:test invocation.
//
// SCOPE: `packages/*/test`, plus the HARNESS-OWNED vendor workspaces listed below.
//
// It is deliberately NOT a blanket `vendors/*` walk. Most of `vendors/` is pristine mirrors
// (`langgraph-harness`, `repository-fingerprint`, `tools-cli-progress-bar`) which pass
// UPSTREAM's gate, not this repo's — running their suites from here would couple this gate to
// their installs and fail for reasons that are not ours. They are excluded from eslint/biome
// for the same reason, and each has its own separate gate.
//
// `langgraph-harness-integration` is also excluded here: it is verified independently and
// offline via its own gate (`npm --prefix vendors/langgraph-harness-integration run verify`) so
// it stays decoupled from the vendored mirror's install.
//
// `langgraph-repo-remediation-html-report-generator` (record 0055/A6) IS collected. It is harness-owned,
// dependency-free, and offline — nothing about it needs decoupling. Leaving it out would have
// silently dropped the renderer from the gate entirely: the pack's suite shrank by the renderer
// tests when they moved, the package's new tests would never run, and the counts would still
// look green. That is the failure class record 0051 caught — work that looks verified while the
// evidence is absent.
const VENDOR_TEST_WORKSPACES = ['langgraph-repo-remediation-html-report-generator'];

const packagesDir = join(root, 'packages');
const testFiles = [];
if (existsSync(packagesDir)) {
  for (const pkg of readdirSync(packagesDir)) {
    collectTests(join(packagesDir, pkg, 'test'), testFiles);
  }
}
for (const vendor of VENDOR_TEST_WORKSPACES) {
  const dir = join(root, 'vendors', vendor, 'test');
  if (!existsSync(dir)) {
    console.error(`verify: vendor workspace '${vendor}' has no test/ directory — the gate expected one.`);
    process.exit(1);
  }
  collectTests(dir, testFiles);
}

if (testFiles.length === 0) {
  console.log('verify: no test files found — nothing to run.');
  process.exit(0);
}

process.exit(run(process.execPath, ['--test', ...testFiles]));
