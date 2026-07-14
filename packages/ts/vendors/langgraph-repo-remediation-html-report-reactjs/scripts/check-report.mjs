#!/usr/bin/env node
/**
 * scripts/check-report.mjs — prove that THIS PACKAGE renders THAT PAGE.
 *
 *   node scripts/check-report.mjs                       # every report under ../../.harness
 *   node scripts/check-report.mjs <path/to/report.html> # one specific report
 *
 * The claim "the React package renders `repo-remediation.html`" is easy to assert and easy to be
 * wrong about — the dev server rendered a different component tree over different data for the
 * whole life of this package and nothing caught it, because nothing ever compared the two. This
 * does compare them, exactly:
 *
 *   1. Read the page's JSON island — the `ReportData` the generator embedded when it wrote it.
 *   2. Re-render it through `renderReport(data)` from the committed bundle.
 *   3. Assert the result is BYTE-IDENTICAL to the page's prerendered `#root` markup.
 *   4. Assert the page's STYLESHEET is byte-identical to the committed `vendor/report.css`.
 *   5. Assert the head still declares `color-scheme: light`.
 *
 * (4) and (5) are not padding. Until they existed this script compared markup ALONE, and a report
 * carrying a stale stylesheet — the same markup painted by last week's CSS — passed green. Every
 * "the static page doesn't match the dev page" report so far has been a CSS divergence, i.e. the
 * exact defect the check was blind to. A page is what it renders, not what its DOM says.
 *
 * A mismatch means the page on disk was written by a different tree than the one in `src/report/`
 * — a stale report, or a stale bundle. Pair it with `build:bundle -- --check` (bundle is fresh from
 * `src/report/`) and the chain is closed end to end: source → bundle → page.
 *
 * It loads the COMMITTED bundle (`../langgraph-repo-remediation-html-report-generator/vendor/`)
 * rather than compiling `src/report/`, because the committed bundle is what the flow actually runs.
 * Checking the source would prove a page nobody renders.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverSessions, extractIsland, extractRoot, extractStyle } from '../dev/sessions.mjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(pkgRoot, '..', 'langgraph-repo-remediation-html-report-generator', 'vendor');
const ssrBundle = join(vendorDir, 'report-ssr.mjs');
const cssBundle = join(vendorDir, 'report.css');

if (!existsSync(ssrBundle)) {
  console.error(`check-report: no committed bundle at ${ssrBundle} — run \`npm run build:bundle\` first.`);
  process.exit(1);
}
const { renderReport } = await import(ssrBundle);
const expectedCss = readFileSync(cssBundle, 'utf8');

/** Report the first divergence by offset — "they differ" is useless, "they differ HERE" is a lead. */
function firstDivergence(actual, expected) {
  let i = 0;
  while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++;
  return (
    `  first divergence at byte ${i} of ${expected.length}\n` +
    `  page:  …${JSON.stringify(expected.slice(Math.max(0, i - 60), i + 60))}\n` +
    `  ours:  …${JSON.stringify(actual.slice(Math.max(0, i - 60), i + 60))}`
  );
}

const arg = process.argv[2];
const targets = arg ? [{ id: arg, file: resolve(arg) }] : discoverSessions();

// A path that was ASKED for and isn't there is an error. Finding no sessions at all is not: a fresh
// clone has never run the flow, and this rung has to stay green offline. The stylesheet/head
// contract is still gated in that state by `reportSurface.test.ts`, which runs against the
// committed golden — so "no sessions" narrows what is checked, it does not stop the checking.
if (targets.length === 0) {
  console.log('check-report: no emitted report under .harness — skipping (the golden is covered by the test suite).');
  process.exit(0);
}

let failed = 0;
for (const { file } of targets) {
  const where = relative(pkgRoot, file);
  if (!existsSync(file)) {
    console.error(`✗ ${where} — no such file`);
    failed++;
    continue;
  }

  const html = readFileSync(file, 'utf8');
  let expected;
  let pageCss;
  let data;
  try {
    data = extractIsland(html);
    expected = extractRoot(html);
    pageCss = extractStyle(html);
  } catch (err) {
    console.error(`✗ ${where} — ${err.message}`);
    failed++;
    continue;
  }

  const problems = [];

  const actual = renderReport(data);
  if (actual !== expected) {
    problems.push(`MARKUP — the page was not rendered by this tree.\n${firstDivergence(actual, expected)}`);
  }

  // The stylesheet is half the page. A stale one repaints correct markup with last week's colors,
  // which is what every "static doesn't match dev" report has actually turned out to be.
  if (pageCss !== expectedCss) {
    problems.push(
      `STYLESHEET — the page ships ${pageCss.length} bytes of CSS; the committed bundle is ${expectedCss.length}.\n` +
        firstDivergence(expectedCss, pageCss),
    );
  }

  // The palette is light-only. Without this declaration a dark-mode UA is free to repaint every
  // surface that inherits its background instead of declaring one.
  if (!html.includes('<meta name="color-scheme" content="light">')) {
    problems.push('HEAD — no `<meta name="color-scheme" content="light">`; a dark-mode UA may repaint the page.');
  }

  if (problems.length === 0) {
    console.log(
      `✓ ${where} — ${data.repos.length} repos, ${expected.length} bytes of markup + ${pageCss.length} bytes of CSS reproduced exactly`,
    );
    continue;
  }

  console.error(
    `✗ ${where}\n${problems.map((p) => `  ${p}`).join('\n')}\n` +
      '  Either the report is stale (re-run the flow) or the bundle is (npm run build:bundle).',
  );
  failed++;
}

if (failed > 0) process.exit(1);
