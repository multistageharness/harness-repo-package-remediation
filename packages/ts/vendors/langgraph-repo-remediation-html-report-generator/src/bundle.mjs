/**
 * src/bundle.mjs — the seam onto the committed React bundle (record 0057/D1).
 *
 * Three generated artifacts live under `../vendor/`, built from the React package's `src/report/`
 * by its `scripts/build-bundle.mjs` and CHECKED IN:
 *
 *   report-ssr.mjs     `renderReport(data) → string` — the prerender, React compiled in
 *   report-client.js   the hydration IIFE — reads the JSON island, calls `hydrateRoot`
 *   report.css         the extracted stylesheet
 *
 * WHY COMMITTED, AND WHY THIS IS LEGAL. React's ~325 dependencies are needed at BUILD time, not at
 * RUNTIME. Because the bundle is a text asset imported by a RELATIVE path, every invariant this
 * package is built on survives byte-unchanged: `package.json` still declares zero dependencies,
 * `src/` still contains no bare import, the tests still run offline with no `node_modules`, and the
 * flow still renders a report without touching a registry — which is not academic on a machine
 * whose local Verdaccio/devpi are frequently down (record 0054). `fixtures.test.mjs` asserts all of
 * that from the other side.
 *
 * The two file reads below are the only I/O in the package, they happen once at module load, and
 * they read this package's OWN committed assets — not external input. Rendering itself stays pure
 * and deterministic, which is what keeps the golden replay gate possible.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderReport } from "../vendor/report-ssr.mjs";

const vendorDir = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor");

/** The hydration script, inlined into a `<script>` — never referenced as an external asset. */
export const CLIENT_JS = readFileSync(join(vendorDir, "report-client.js"), "utf8");

// The client bundle is inlined RAW into `<script>…</script>`. A literal `</script` anywhere in it
// would close that tag early and shred the page — the same hazard `serializeIsland` neutralizes for
// the DATA, but the data can be escaped and executable code cannot (escaping it would change what it
// runs). Today React writes its own occurrence as `<\/script>` precisely to avoid this, so the
// bundle is clean; nothing GUARANTEES the next dependency will be as careful. Fail loudly at load
// rather than emit a silently broken report — a corrupted page is far more expensive to diagnose
// than this assertion is to read.
if (/<\/script/i.test(CLIENT_JS)) {
  throw new Error(
    "report bundle: report-client.js contains a literal `</script`, which would terminate the inline " +
      "<script> tag and corrupt every emitted report. Rebuild the bundle; if a dependency introduced it, " +
      "the bundle must be emitted as a data: URI or base64 payload instead of inlined raw.",
  );
}

/** The stylesheet, inlined into a `<style>` — never referenced with `<link href>`. */
export const REPORT_CSS = readFileSync(join(vendorDir, "report.css"), "utf8");

export { renderReport };
