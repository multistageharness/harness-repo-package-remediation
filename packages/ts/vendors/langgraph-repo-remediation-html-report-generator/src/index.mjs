/**
 * src/index.mjs — the package's ONLY entry point.
 *
 * `package.json`'s `exports` map pins the public surface to this file, so every other
 * module here (`render`, `tokens`, `derive`, `style`, `client`, `document`, `channels`)
 * is unreachable from outside. The surface is enforced, not merely documented.
 *
 * | Export           | Purpose                                                        |
 * | :--------------- | :------------------------------------------------------------- |
 * | `renderDocument` | the full standalone `<!doctype html>` page — what the atom writes |
 * | `renderHtml`     | the body only — for embedding                                  |
 * | `buildReportData`| the DATA contract (record 0057/A2) — channels → serializable `ReportData` |
 * | `REPORT_CHANNELS`| the input contract; the atom derives its `meta.params` from it  |
 * | `esc`            | the HTML escaper — for callers composing fragments              |
 * | `defaultKeyOf`   | the standalone repo-key fallback (record 0055/A3)               |
 *
 * `buildReportData` is public because record 0057 splits this package in two: it GETS THE DATA
 * (from the pipeline's generated artifacts) and the React package USES THE DATA to render the
 * experience. The value it returns is what gets embedded in the emitted page as a JSON island
 * and handed to the prerender + hydration bundle — so it is a contract, not an internal.
 *
 * `defaultKeyOf` is public for one specific reason: record 0055/A3 requires a PARITY
 * TEST in the pack asserting it agrees with the pack's `normalizeRepoUrl` across the
 * fixture corpus. That test can only hold both symbols if this one is importable — and
 * a fallback that cannot be compared to the real key is a fallback that drifts silently.
 * (The record's summary table lists four symbols; this is the fifth its own A3 implies.)
 */

export { BUMP_LEVELS, bumpLevel } from "./bump.mjs";
export { REPORT_CHANNELS } from "./channels.mjs";
export { buildReportData, defaultKeyOf } from "./data.mjs";
export { esc, serializeIsland } from "./document.mjs";
export { renderDocument, renderHtml } from "./report.mjs";
export { verdictChipKey } from "./tokens.mjs";
