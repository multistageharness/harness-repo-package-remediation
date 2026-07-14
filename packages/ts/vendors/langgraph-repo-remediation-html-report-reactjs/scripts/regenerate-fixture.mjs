#!/usr/bin/env node
/**
 * regenerate-fixture.mjs — rebuild `src/report/__fixtures__/report-data.json` from the generator.
 *
 * THE FIXTURE IS DERIVED, AND UNTIL NOW NOTHING SAID SO. It is exactly
 * `buildReportData(adversarialChannels)` — the generator's deliberately NON-green recorded run (a
 * skipped remediation, a failed repo, a rule-injected action, a blocked repo, an `n/a` build) — but
 * it was committed as a bare JSON blob with no way to reproduce it. So when a field was added to the
 * data layer, the React tree's own fixture silently kept the OLD shape, and `Report.test.tsx` went on
 * asserting against a payload no generator would emit again. A fixture that cannot be regenerated
 * does not pin the contract; it pins a memory of it.
 *
 *   node scripts/regenerate-fixture.mjs          # rewrite it
 *   node scripts/regenerate-fixture.mjs --check  # is it stale? (exit 1 if so) — for the gate
 *
 * This is the same checkpoint-not-monument rule the generator's golden carries
 * (`generator/test/fixtures/regenerate.mjs`): when you intentionally change the contract, this goes
 * stale, and you regenerate it knowing which fields moved. Never regenerate to turn a red test green.
 *
 * The import reaches into the sibling generator package by relative path. That is the real dependency
 * direction — the generator OWNS the contract and vendors this package's built bundle — and it is
 * dev-only: nothing here is imported by `src/`, so it never reaches the shipped bundle.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReportData } from '../../langgraph-repo-remediation-html-report-generator/src/index.mjs';
import { adversarialChannels } from '../../langgraph-repo-remediation-html-report-generator/test/fixtures/adversarial.mjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(pkgRoot, 'src', 'report', '__fixtures__', 'report-data.json');

const check = process.argv.includes('--check');

const next = `${JSON.stringify(buildReportData(adversarialChannels), null, 2)}\n`;
const current = await readFile(FIXTURE, 'utf8').catch(() => null);

if (current === next) {
  console.log(`fixture is up to date (${Buffer.byteLength(next)} bytes) — nothing to do.`);
  process.exit(0);
}

const delta = current === null ? '(absent)' : `${Buffer.byteLength(current)} → ${Buffer.byteLength(next)} bytes`;
if (check) {
  console.error(`report-data.json is STALE: ${delta}. Re-run without --check to rewrite it.`);
  process.exit(1);
}

await writeFile(FIXTURE, next);
console.log(`fixture regenerated: ${delta}`);
