/**
 * src/tokens.mjs — the report's design + domain token tables (task002 SEV /
 * OUTCOME / ECO, plus the per-ecosystem skill and toolset names).
 *
 * Moved verbatim from the pack's `html-report-lib.mjs:46-83` (change record 0055/D1).
 * These are the tables a theme change or a new ecosystem reaches for, which is why
 * they get their own module instead of staying buried in a 1.1k-line renderer.
 */

/** Outcome keys, in the order the ledger renders them. */
export const STATUS_ORDER = ["fixed", "broken", "blocked", "skipped", "bug"];

export const SEV = {
  critical: { hex: "#e11d48", rank: 0 },
  high: { hex: "#f97316", rank: 1 },
  medium: { hex: "#f59e0b", rank: 2 },
  low: { hex: "#94a3b8", rank: 3 },
  unknown: { hex: "#94a3b8", rank: 4 },
};
export const sev = (s) => SEV[s] ?? SEV.unknown;

export const OUTCOME = {
  fixed: "#059669",
  broken: "#e11d48",
  blocked: "#d97706",
  skipped: "#64748b",
  bug: "#7c3aed",
};

export const ECO = {
  node: { label: "node", manifest: "package.json", lock: "package-lock.json" },
  java: { label: "java", manifest: "pom.xml", lock: "dependency-tree.txt" },
  python: { label: "python", manifest: "requirements.txt", lock: "pip-freeze.txt" },
  unknown: { label: "unknown", manifest: "manifest", lock: "lockfile" },
};
export const eco = (e) => ECO[e] ?? ECO.unknown;

export const SKILLS = { node: "npm-remediation", java: "maven-remediation", python: "pip-remediation", unknown: "remediation" };
export const TOOLSETS = {
  node: ["npm-audit-fix", "npm-overrides-pin", "npm-version-bump", "manifest-edit"],
  java: ["gradle-version-bump", "maven-dependency-pin", "maven-version-bump", "manifest-edit"],
  python: ["pip-constraints-pin", "pip-requirement-bump", "manifest-edit"],
  unknown: ["manifest-edit"],
};

/**
 * Map a repo's overall VERDICT to the outcome key the chip CSS actually colors (record 0056/A2).
 *
 * Moved here from `render.mjs` by record 0057/A3 — the renderer retires as UI author, but this is a
 * TOKEN MAPPING, not markup, and both the React tree and the generator's tests need it to outlive
 * that deletion. (`behavior.test.mjs` imports it from the package entry point and asserts the whole
 * table, precisely because the mapping is the part that is easy to get wrong.)
 *
 * THE MAP IS NOT THE IDENTITY, and that is the trap. A repo's verdict vocabulary
 * (`clean`/`failed`/`attention`/`blocked`/`noop`, from remediation-validate.mjs) is NOT the
 * per-package outcome vocabulary (`fixed`/`broken`/`blocked`/`skipped`/`bug`) the chip CSS has
 * rules for. Only `blocked` appears in both. Passing a verdict straight through as a chip key —
 * the obvious fix, and the one record 0056/A2 literally proposed — emits `data-out="clean"` /
 * `"failed"` / `"noop"`, none of which the CSS colors: every one renders as an unstyled gray chip.
 * That un-greens every clean repo AND still fails to redden a failed one.
 */
const VERDICT_CHIP = { clean: "fixed", failed: "broken", attention: "blocked", blocked: "blocked", noop: "skipped" };

/** An unrecognized verdict must never inherit green by accident — fall back to neutral gray. */
export function verdictChipKey(overall) {
  return VERDICT_CHIP[overall] ?? "skipped";
}
