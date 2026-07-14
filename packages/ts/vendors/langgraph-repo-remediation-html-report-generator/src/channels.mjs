/**
 * src/channels.mjs — the report's INPUT CONTRACT.
 *
 * The pipeline channels `renderHtml` reads, in the order the pack's flow produces
 * them. This list was the pattern's private `CHANNELS` const (change record 0055/A2);
 * it now lives with the renderer that actually reads it, so the atom's `meta.params`
 * (`<channel>_from` overrides) can be DERIVED from it instead of hand-synced. Adding a
 * channel here is therefore a single edit, not two lists in two packages.
 */

/** The channel names `renderHtml` reads off the state object. */
export const REPORT_CHANNELS = [
  // run-health-and-errors-log Epic 03: the run-scoped service-health fact —
  // the stamped source of the report's environment banner (never re-derived
  // in the renderer).
  "service_health",
  "dataset",
  "clone_results",
  "plans",
  "optimized_prompts",
  "remediations",
  "validations",
  "installs",
  "install_verifications",
  "builds",
  "tests",
  "dependency_graphs",
  "snapshots",
  "build_snapshots",
];
