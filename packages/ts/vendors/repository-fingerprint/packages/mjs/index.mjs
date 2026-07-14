/**
 * @repo-fingerprint/report — dependency-free ESM report-generation library.
 *
 * The provider-agnostic logic that shapes the two harness artifacts built on top
 * of a repository fingerprint:
 *   - `setup-report.mjs`   → the `.harness/integrated.json` manifest contract
 *   - `fingerprint-report.mjs` → the `.harness/fingerprints.json` entry shaping
 *
 * Consumers (e.g. the langgraph-harness `skills.detectSetup` /
 * `commands.repoFingerprint` atoms) import these builders and supply the host
 * concerns the library deliberately does NOT own: the LLM seam, subprocess
 * execution, state channels, and events.
 */
export * from "./setup-report.mjs";
export * from "./fingerprint-report.mjs";
