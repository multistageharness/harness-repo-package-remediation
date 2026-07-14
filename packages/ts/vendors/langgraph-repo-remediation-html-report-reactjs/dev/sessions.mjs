/**
 * dev/sessions.mjs — the dev harness's DATA SOURCE. Node-side; loaded by `vite.config.ts`.
 *
 * The dev server used to render `organisms/RemediationReport` over `SAMPLE_REPOS`, i.e. the design
 * mock over invented data, while the shipped page renders `src/report/` over `ReportData`. Two
 * trees, two contracts — so `http://localhost:5247` and a generated `repo-remediation.html` showed
 * visibly different reports, which is exactly the drift record 0057 was filed to end.
 *
 * The fix is to give the dev harness the SAME data the page carries. Every report the flow emits
 * embeds its `ReportData` verbatim in a `<script type="application/json" id="report-data">` island
 * (record 0057/D2) — that island IS `buildReportData(channels)`'s return value, so reading it back
 * out is not an approximation of the shipped data, it is the shipped data. No pipeline re-run, no
 * channel reconstruction, no fixtures.
 *
 * Resolution order for what to render:
 *   1. `HARNESS_REPORT_HTML=<path>`  — one specific report file.
 *   2. `HARNESS_SESSIONS_DIR=<dir>`  — a directory of `<session-id>/repo-remediation.html`.
 *   3. `../../.harness`              — the default: this package sits at `harness-repo-package-remediation/vendors/<pkg>`,
 *                                      and the flow writes sessions to `harness-repo-package-remediation/.harness/<id>/`.
 *
 * Paths stay relative to this package. Nothing here hard-codes a host layout.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The generator's OWN classifier and inventory builder — not copies of them. See `backfill` below.
import { bumpLevel } from '../../langgraph-repo-remediation-html-report-generator/src/bump.mjs';
import { buildRepoInventory } from '../../langgraph-repo-remediation-html-report-generator/src/data.mjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Where the flow writes its sessions, unless the environment says otherwise. */
export const sessionsDir = process.env.HARNESS_SESSIONS_DIR
  ? resolve(process.env.HARNESS_SESSIONS_DIR)
  : resolve(pkgRoot, '..', '..', '.harness');

const REPORT_FILE = 'repo-remediation.html';

/**
 * Pull `ReportData` back out of an emitted report.
 *
 * The island's text is JSON with `<` written as the `<` escape (`serializeIsland` does that so
 * a `</script` inside a repo name or an LLM-authored prompt cannot terminate the tag). `JSON.parse`
 * decodes that escape natively, so nothing has to be un-escaped here — the value that comes back is
 * byte-for-byte the one the generator serialized.
 */
export function extractIsland(html) {
  const m = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script id="report-data"> island — was this page emitted by the 0057 renderer?');
  return JSON.parse(m[1]);
}

/**
 * The report stylesheet the page shipped with — the `<style>` that DEFINES the design tokens.
 *
 * Two `<style>` blocks reach the page: this one, and the CSS-radio nav sheet, which only ever
 * REFERENCES the tokens (`var(--indigo-bg)`). Discriminating on a reference matches both; the
 * definition (`--card:#ffffff`) matches exactly one.
 */
export function extractStyle(html) {
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].filter((m) => m[1].includes('--card:#ffffff'));
  if (blocks.length !== 1) {
    throw new Error(`expected exactly 1 token-defining <style>, found ${blocks.length} — did the stylesheet split?`);
  }
  return blocks[0][1];
}

/** The prerendered markup of `#root` — what `renderReport(data)` produced when the page was written. */
export function extractRoot(html) {
  const open = html.indexOf('<div id="root">');
  if (open < 0) throw new Error('no <div id="root"> in the page');
  const start = open + '<div id="root">'.length;
  // The island is the next element after the root div closes, so it bounds the search reliably —
  // `lastIndexOf('</div>')` over the whole document would be defeated by the client bundle's text.
  const end = html.indexOf('<script type="application/json" id="report-data">', start);
  if (end < 0) throw new Error('no island after #root — cannot bound the prerendered markup');
  return html.slice(start, html.lastIndexOf('</div>', end));
}

/**
 * Give an OLDER island the fields the current tree expects, without inventing any of them.
 *
 * `Remediation.bump` (the size of a version move) was added to the data layer after every report
 * now on disk was written, so those islands carry `from` and `to` but no `bump` — and the dev
 * harness's entire contract is rendering the SHIPPED tree over REAL emitted data. Without this, the
 * one thing you cannot see on the dev server is the newest thing in the report.
 *
 * Two rules make this a backfill rather than a fabrication, and both matter:
 *
 *   - it calls the GENERATOR'S OWN `bumpLevel` — the same function `data.mjs` stamps the field with.
 *     Not a mirror of it, not a reimplementation: the rule has one definition, and a second copy in
 *     this file is exactly the drift that keeps producing defects in this report (0056/A2 was two
 *     copies of one expression).
 *   - it only fills what is ABSENT. A bump already in the island is the generator's answer and is
 *     never overwritten, so this can never disagree with an emitted page.
 *
 * It is dev-only. Nothing here reaches the shipped bundle; a page emitted today carries the field.
 */
function backfill(data) {
  for (const repo of data.repos ?? []) {
    for (const rep of repo.reps ?? []) {
      if (rep.bump === undefined) rep.bump = bumpLevel(rep.from, rep.to);
    }
    // `Repo.inventory` was added when the package inventory moved OUT of a run-wide top-level view
    // and INTO each repo's Dependencies tab. Islands emitted before that carry a run-wide
    // `data.inventory` and no per-repo one — but they DO carry the `nodes` and `edges` it is derived
    // from, so the tab can be rendered for them rather than reading as "no graph was captured".
    //
    // The same two rules that make the `bump` backfill a backfill and not a fabrication hold here:
    // it calls the GENERATOR'S OWN builder (the one `data.mjs` stamps the field with, so the dev
    // page cannot disagree with an emitted one), and it only fills what is ABSENT. It derives
    // nothing that is not already in the island.
    if (repo.inventory === undefined) repo.inventory = buildRepoInventory(repo.nodes, repo.edges);
  }
  return data;
}

/** One rendered report on disk, plus enough metadata for the dev picker to label it. */
function readSession(id, file) {
  const data = backfill(extractIsland(readFileSync(file, 'utf8')));
  return {
    id,
    file,
    mtime: statSync(file).mtimeMs,
    repos: data.repos.length,
    vulns: data.totals.vulns,
    data,
  };
}

/**
 * Every report we can render, newest first.
 *
 * Re-read on every call — the dev server calls this per request, so a flow run that rewrites a
 * report shows up on the next reload without restarting vite.
 */
export function discoverSessions() {
  const explicit = process.env.HARNESS_REPORT_HTML;
  if (explicit) {
    const file = resolve(explicit);
    if (!existsSync(file)) return [];
    return [readSession(basenameId(file), file)];
  }

  if (!existsSync(sessionsDir)) return [];

  const found = [];
  for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(sessionsDir, entry.name, REPORT_FILE);
    if (!existsSync(file)) continue;
    try {
      found.push(readSession(entry.name, file));
    } catch (err) {
      // A half-written or pre-0057 report must not take the whole harness down — skip it loudly.
      console.warn(`[report-data] skipping ${file}: ${err.message}`);
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/** `…/<session-id>/repo-remediation.html` → `<session-id>`; anything else → the file's own name. */
function basenameId(file) {
  const parent = dirname(file);
  return parent.split(/[\\/]/).pop() || file;
}
