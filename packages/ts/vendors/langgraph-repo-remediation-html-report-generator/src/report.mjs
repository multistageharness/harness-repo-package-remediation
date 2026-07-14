/**
 * src/report.mjs — the page composer (change record 0057/A6 + D2).
 *
 * This is what replaced the 872-line hand-written renderer. The split it embodies is the whole of
 * record 0057:
 *
 *   data.mjs      GETS THE DATA     channels → a serializable `ReportData`
 *   the bundle    RENDERS THE UI    React, compiled by Vite, prerendered + hydrated
 *   this file     ASSEMBLES THEM    one self-contained page
 *
 * Before this, the generator and the React package rendered the same screen from two independent
 * implementations that shared no code — and had already drifted to the point of having DISJOINT
 * `data-testid` vocabularies (record 0057/F2). React is now the single source of truth for markup,
 * CSS, and interactivity; this package no longer authors any of them.
 *
 * PRERENDER + HYDRATE (user-confirmed). The markup is fully rendered server-side, so the page is
 * complete and navigable before a line of JavaScript runs — and stays that way with the script
 * blocked entirely (navigation is CSS radios; see the React package's `navCss.ts` and record
 * 0057/D3). The client bundle only upgrades it in place.
 *
 * `renderDocument` and `renderHtml` KEEP THEIR SIGNATURES (record 0057/F7). That is a deliberate
 * constraint, not an accident: it is what leaves the pack's `render-html-report.mjs` adapter and the
 * flow's terminal `html_report` node untouched by this entire switchover.
 */
import { CLIENT_JS, REPORT_CSS, renderReport } from "./bundle.mjs";
import { buildReportData } from "./data.mjs";
import { serializeIsland, wrapDocument } from "./document.mjs";

/**
 * Render the report BODY — no `<head>`; use `renderDocument` for a standalone page.
 *
 * The body is four inline pieces, in the order the browser needs them:
 *   1. `<style>`  the bundle's extracted stylesheet
 *   2. `<div id="root">`  the PRERENDERED markup — every view, every repo, every tab panel
 *   3. the JSON data island — the same `ReportData` the prerender used
 *   4. `<script>`  the hydration bundle, which reads (2)'s DOM and (3)'s data
 *
 * @param {object} channels the pipeline output channels (see `REPORT_CHANNELS`)
 * @param {{keyOf?: (u: unknown) => string|null}} [opts] `keyOf` is the repo join key (record
 *   0055/A3) — inject the pipeline's own normalizer so the report joins on exactly the key the
 *   channels were built with.
 * @returns {string} a complete, self-contained HTML document body
 */
export function renderHtml(channels = {}, opts = {}) {
  const data = buildReportData(channels, opts);
  const markup = renderReport(data);

  // The island is `type="application/json"`, so the browser does not execute it — it is inert data
  // that the client bundle reads with `JSON.parse`. See `serializeIsland` for why `esc()` is the
  // wrong escaper here and `<` is the right one.
  return `<style>${REPORT_CSS}</style>
<div id="root">${markup}</div>
<script type="application/json" id="report-data">${serializeIsland(data)}</script>
<script>${CLIENT_JS}</script>`;
}

/**
 * Render the full standalone `<!doctype html>` page — what the pack's `commands.renderHtmlReport`
 * atom writes to disk.
 *
 * @param {object} channels the pipeline output channels (see `REPORT_CHANNELS`)
 * @param {{keyOf?: (u: unknown) => string|null}} [opts] see `renderHtml`
 * @returns {string} a complete, self-contained, offline HTML document
 */
export function renderDocument(channels = {}, opts = {}) {
  return wrapDocument(renderHtml(channels, opts));
}
