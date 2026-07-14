/**
 * fingerprint-report.mjs — the deterministic shaping of the per-repo entry that
 * lands in `.harness/fingerprints.json`.
 *
 * The fingerprint DATA is produced by this tool's presence-scanner (the bash
 * twin at `packages/bash/repo-fingerprint.sh`, or a language twin). This module
 * owns the two shaping decisions the harness orchestrator would otherwise
 * inline: the mock/missing-dir STUB, and the "parse the scanner's JSON, degrade
 * to an error marker rather than throw" reader. Keeping them here means the
 * fingerprints report has a single owner alongside the scanner that feeds it.
 *
 * Dependency-free (no imports) and provider-agnostic — the host supplies the
 * scanner stdout; this module never spawns a subprocess or reads the fs.
 */

/**
 * A deterministic, side-effect-free stub fingerprint — used under mock or for a
 * missing/mock-cloned repo dir. Mirrors the scanner's report shape with an
 * explicit `generatedBy: "stub"` provenance marker.
 */
export function stubFingerprint(dir) {
  return { generatedBy: "stub", root: dir ?? null, dominantEcosystem: null, ecosystems: [] };
}

/**
 * Parse the presence-scanner's JSON report; degrade to an error marker rather
 * than throw so one unparseable repo never aborts the fan-out. The scanner emits
 * exit 1 ("no ecosystem detected") with a still-valid report, so the caller
 * allows non-zero exits and hands the stdout here regardless.
 */
export function parseReport(stdout, dir) {
  try {
    return JSON.parse(stdout);
  } catch {
    return { generatedBy: "bash", root: dir, error: "unparseable fingerprint report" };
  }
}
