/**
 * commands.renderHtmlReport — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the terminal SINGLE-HTML
 * report stage (langgraph-flow.md capability 8 — "based on all generated report
 * artifacts generate a single HTML report that explains the outcome").
 *
 * This is a THIN ADAPTER (change record 0055/A2). The renderer itself lives in its own
 * vendor package — `@harness/langgraph-repo-remediation-html-report-generator` — and is consumed
 * here by bare specifier. The adapter owns exactly the concerns the FLOW owns:
 *
 *   - picking the channels off the graph state (honoring `<channel>_from` overrides),
 *   - injecting the pipeline's repo-key normalizer (see below),
 *   - resolving `out_dir` against the flow dir,
 *   - respecting `ctx.options.dryRun`,
 *   - writing atomically and reporting the bytes.
 *
 * Everything else — WHAT it reads (`REPORT_CHANNELS`), HOW it renders, and the document
 * it wraps the body in — belongs to the package. Deterministic (no clock, no I/O beyond
 * the single write). It writes even under `--mock`: the HTML report IS the deliverable,
 * the same way the JSON reports are written under mock.
 *
 * `keyOf` (record 0055/A3): the report joins its channels into per-repo rows by
 * normalizing each row's repo URL, and that key MUST be the same one the pipeline built
 * those channels with — otherwise repos silently fail to join and the detail panels
 * render empty. `src/repo-url.mjs` is the pipeline's single source of truth for repo
 * identity (ten modules import it), so it is injected here rather than copied into the
 * package, where it would drift on the first ingest-layer fix and fail SILENTLY.
 *
 * Trust boundary: lives under `configs/patterns/`; imports the pack's own `src/` bridges
 * plus one declared workspace dependency. `out_dir` resolves against the flow dir — never
 * a host-absolute path in yaml.
 *
 * FROZEN NAMES — do not rename while refactoring. `src/render-flow.mjs`'s `OVERLAYS`
 * allowlist addresses this atom's params BY NAME (`nodes.html_report.with.out_dir` /
 * `.filename`) and `setFlowValue` THROWS on a miss. Renaming `out_dir` would not break a
 * unit test; it would break the wizard's materialize path and silently scatter the report
 * into the vendored pack (the failure class records 0043–0048 spent six records fixing).
 */

import { isAbsolute, join, resolve } from "node:path";

import { REPORT_CHANNELS, renderDocument } from "@harness/langgraph-repo-remediation-html-report-generator";

import { writeFileAtomic } from "../../src/sdk.mjs";
import { normalizeRepoUrl } from "../../src/repo-url.mjs";

export const meta = {
  name: "commands.renderHtmlReport",
  category: "commands",
  summary:
    "Render every pipeline channel into one self-contained, escaped HTML report (Modern Minimalist theme) and write it atomically — the single-page run outcome.",
  params: {
    type: "object",
    required: ["out_dir", "into"],
    properties: {
      // Optional per-channel state-key overrides, each defaulting to the channel name.
      // DERIVED from the package's REPORT_CHANNELS rather than hand-written: these two
      // lists used to live in two files and had to be kept in lockstep by hand, and
      // forgetting one failed SILENTLY (the override key was simply never honored).
      ...Object.fromEntries(REPORT_CHANNELS.map((c) => [`${c}_from`, { type: "string" }])),
      out_dir: { type: "string", minLength: 1 },
      filename: { type: "string" },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function renderHtmlReport(params, ctx) {
  return async (state) => {
    const channels = {};
    for (const name of REPORT_CHANNELS) {
      const key = params[`${name}_from`] ?? name;
      channels[name] = state[key];
    }
    const html = renderDocument(channels, { keyOf: normalizeRepoUrl });

    const outDir = isAbsolute(params.out_dir) ? params.out_dir : resolve(ctx.options.baseDir, params.out_dir);
    const filename = params.filename ?? "repo-remediation.html";
    const target = join(outDir, filename);

    if (ctx.options.dryRun) {
      ctx.emit?.("node.end", { note: `dry_run: skipped html report write to ${target}` });
      return { [params.into]: { path: target, written: false, dry_run: true } };
    }
    await writeFileAtomic(target, html);
    return { [params.into]: { path: target, written: true, bytes: Buffer.byteLength(html) } };
  };
}
