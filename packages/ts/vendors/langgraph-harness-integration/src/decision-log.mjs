/**
 * src/decision-log.mjs — the run-scoped decision audit trail (change record
 * 0032/D1). Every choice the pipeline makes — candidacy verdict, policy rule
 * matched, target-resolution rung (0032/A4), writer dispatch, final apply/skip,
 * contract verdicts (0032/D7) — is appended as ONE JSONL line to the session
 * artifact root:
 *
 *   .harness/<SESSION_ID>/decision.jsonl
 *
 * WHY: run `a52fbfa5` applied 0 of 12 planned remediations and explaining it
 * took a full forensic pass, because only the FINAL skipReason survived. With
 * the log, "why this version?" / "why skipped?" is answerable from the run
 * artifacts alone.
 *
 * Contract:
 * - DISABLED when no path is configured (atoms take an optional `decision_log`
 *   param) — unit tests and hand-built states log nothing, exactly as before.
 * - Mock-identical IN SHAPE: mock runs log the same line shapes with
 *   `mock: true`, so the offline acceptance gate exercises the logger. The
 *   log is a run ARTIFACT (like the JSON reports the mock flow already
 *   writes), not a mutation of any cloned repo.
 * - Degrade-don't-throw: an unwritable log path disables the logger after one
 *   recorded warning line on the logger object; it never aborts a stage.
 * - No secrets in lines (security rule 5) — callers pass only packages,
 *   versions, rule indexes, and reasons.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Build a logger for `path` (absolute). Returns `{ enabled, path, log }`;
 * when `path` is falsy the logger is a no-op with `enabled: false`.
 * @param {{ path?: string|null, mock?: boolean, stage?: string }} options
 */
export function createDecisionLogger({ path = null, mock = false, stage = null } = {}) {
  if (typeof path !== "string" || path.length === 0) {
    return { enabled: false, path: null, error: null, log: async () => false };
  }
  let ready = null; // lazy one-time mkdir of the parent
  const logger = {
    enabled: true,
    path,
    error: null,
    /**
     * Append one decision line. Returns true when written, false when the
     * logger is disabled or the write failed (error retained on the logger).
     * @param {Record<string, unknown>} fields
     */
    async log(fields) {
      if (!logger.enabled) return false;
      try {
        if (ready === null) ready = mkdir(dirname(path), { recursive: true });
        await ready;
        const line = {
          ts: new Date().toISOString(),
          ...(stage ? { stage } : {}),
          ...fields,
          mock: mock === true,
        };
        await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
        return true;
      } catch (err) {
        // Degrade: remember why, stop trying — never abort the stage.
        logger.enabled = false;
        logger.error = err.message;
        return false;
      }
    },
  };
  return logger;
}
