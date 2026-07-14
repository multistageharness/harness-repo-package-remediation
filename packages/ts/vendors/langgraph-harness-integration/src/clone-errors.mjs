/**
 * src/clone-errors.mjs — pure classifier mapping git clone failure text to one
 * of four classes (renovate-harness-enhancements Epic 01, story 01/01/01;
 * record 0019/A1). Port of Renovate's retryable-vs-fatal datasource split onto
 * git stderr: the clone atom decides retry-vs-record from the class, never by
 * parsing stderr itself.
 *
 * Ordering is load-bearing: auth_required is checked BEFORE not_found —
 * GitHub reports private repos as "not found" only when unauthenticated, so a
 * 403/auth string must win when both appear. Anything unmatched (including
 * null/non-Error input) is "unknown" — fatal by default, never silently
 * retried. Pure function: no imports, no fs, no subprocess.
 */

export const CLONE_ERROR_CLASSES = ["transient", "auth_required", "not_found", "unknown"];

const CLASSIFIERS = [
  ["transient", /timed out|connection timed out|could not resolve host|network is unreachable|early EOF|RPC failed/i],
  ["auth_required", /authentication failed|could not read username|permission denied|\b403\b/i],
  ["not_found", /repository .*not found|not found|does not exist|\b404\b/i],
];

/** Classify a git clone failure: "transient" | "auth_required" | "not_found" | "unknown". */
export function classifyCloneError(err) {
  const msg = String(err?.stderr ?? err?.message ?? "");
  for (const [cls, pattern] of CLASSIFIERS) {
    if (pattern.test(msg)) return cls;
  }
  return "unknown";
}
