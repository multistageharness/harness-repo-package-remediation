#!/usr/bin/env node
/**
 * scripts/build-bundle.mjs — build the report bundle and publish it into the generator (0057/D1).
 *
 * Runs both Vite builds and copies three self-contained artifacts into the generator's `vendor/`:
 *
 *   report-ssr.mjs     the SSR half — `renderReport(data) → string`, React compiled in
 *   report-client.js   the hydration half — an IIFE that reads the JSON island
 *   report.css         the extracted stylesheet
 *
 * They are CHECKED IN. That is the decision (record 0057/D1, user-confirmed) that keeps the
 * generator's zero-dependency + offline invariants true: it imports these by a RELATIVE path and
 * installs nothing, so the flow can render a report with no `node_modules` and no registry — which
 * matters concretely on a machine whose local Verdaccio/devpi are frequently down (record 0054).
 *
 * The cost of committing generated output is that it can go STALE, so `--check` is the gate that
 * makes staleness loud: it rebuilds, compares, writes nothing, and exits 1 on drift. That is the
 * exact pattern the golden fixture's `regenerate.mjs --check` already uses; the bundle pays the
 * same cost with the same tool.
 *
 *   node scripts/build-bundle.mjs           build and publish
 *   node scripts/build-bundle.mjs --check   fail if the committed bundle is out of date
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const generatorVendor = join(pkgRoot, '..', 'langgraph-repo-remediation-html-report-generator', 'vendor');

/** built artifact → the name it is published under. */
const ARTIFACTS = [
  { from: join(pkgRoot, 'dist', 'ssr', 'report-ssr.mjs'), name: 'report-ssr.mjs' },
  { from: join(pkgRoot, 'dist', 'client', 'report-client.js'), name: 'report-client.js' },
  { from: join(pkgRoot, 'dist', 'client', 'report.css'), name: 'report.css' },
];

const check = process.argv.includes('--check');

// argv-list subprocess, never an interpolated command string (security rule 4).
const vite = join(pkgRoot, 'node_modules', '.bin', 'vite');
if (!existsSync(vite)) {
  console.error('build-bundle: vite is not installed — run `npm install` in the React package first.');
  process.exit(1);
}
for (const config of ['vite.ssr.config.ts', 'vite.client.config.ts']) {
  execFileSync(vite, ['build', '--config', config], { cwd: pkgRoot, stdio: 'inherit' });
}

const HEADER = `/* GENERATED — do not edit. Built from src/report/ by scripts/build-bundle.mjs (record 0057/D1).
 * Rebuild with: npm run build:bundle    Verify freshness with: npm run build:bundle -- --check
 */\n`;

mkdirSync(generatorVendor, { recursive: true });

let drifted = 0;
for (const { from, name } of ARTIFACTS) {
  const built = readFileSync(from, 'utf8');
  // CSS uses the same `/* */` comment syntax as JS, so one header shape serves all three.
  const next = HEADER + built;
  const dest = join(generatorVendor, name);
  const current = existsSync(dest) ? readFileSync(dest, 'utf8') : null;

  if (current === next) {
    console.log(`build-bundle: ${name} is up to date`);
    continue;
  }
  if (check) {
    console.error(
      `build-bundle: ${name} is STALE — the committed bundle does not match a fresh build of src/report/.\n` +
        '  Run `npm run build:bundle` and commit the result.',
    );
    drifted++;
    continue;
  }
  writeFileSync(dest, next);
  console.log(`build-bundle: wrote ${name} (${Buffer.byteLength(next)} bytes)`);
}

if (drifted > 0) process.exit(1);
