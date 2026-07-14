/**
 * src/diagnose-lib.mjs — PURE failure-cause diagnosis (langgraph-flow.md
 * capability 9 — "reason-for-broken insight", the deterministic core).
 *
 * Given the raw stdout/stderr text of a FAILED install / build / test step,
 * classify WHY it failed so the validate stage can tell:
 *
 *   · an ENVIRONMENTAL failure (a down registry — `ECONNREFUSED` to Verdaccio
 *     `:4873` / devpi `:3141`) — NOT the remediation's fault → `blocked`;
 *   · a PRE-EXISTING / TOOLCHAIN failure (a `tsc` deprecation, a config break
 *     that predates and is independent of the dependency edit) → `blocked`;
 *   · a LOCKFILE-DRIFT failure (npm ci `EUSAGE`; the manifest edit outran the
 *     lockfile) — benign, non-attributable (the install fallback re-solves it,
 *     and re-sync closes it) → `blocked`;
 *   · a DEPENDENCY-CONFLICT the edit itself introduced (`ERESOLVE`, a peer
 *     conflict naming the bumped package) — the edit's OWN fault → `broken`.
 *
 * This is the remediation002 headline made executable: every one of that run's
 * 10 "broken" outcomes was environmental / pre-existing / lockfile-drift, NOT a
 * wrong edit; a correct pipeline classifies them `blocked`, not `broken`, so the
 * report never blames the remediation for a Docker outage.
 *
 * No I/O, no clock, no subprocess, no LLM — a pure text→label function,
 * unit-testable in isolation (platform rule 3: identical under `--mock`). The
 * caller supplies the already-read text; matching is case-insensitive over a
 * bounded sample the caller is responsible for truncating.
 */

/** Registry / network unreachable — the dominant remediation002 cause (A). */
const ENVIRONMENT_PATTERNS = [
  /\bECONNREFUSED\b/i,
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /connection refused/i,
  /failed to establish a new connection/i,
  /NewConnectionError/i,
  /network is unreachable/i,
  /getaddrinfo\s+(?:ENOTFOUND|EAI_AGAIN)/i,
  // npm FetchError against the pinned localhost registry (Verdaccio :4873).
  /request to https?:\/\/localhost:\d+\/\S*\s+failed/i,
  // pip / urllib3 against the pinned localhost index (devpi :3141).
  /HTTPConnection\(host=['"]?localhost/i,
  /Max retries exceeded with url/i,
];

/**
 * A build/toolchain break that predates and is independent of the edit (D) —
 * e.g. the repo's `tsconfig.json moduleResolution=node10` under TypeScript 7.x.
 */
const TOOLCHAIN_PATTERNS = [
  /error TS5107\b/i,
  /moduleResolution[^\n]*deprecated/i,
  /['"]?ignoreDeprecations['"]?/i,
  /is deprecated and will stop functioning/i,
];

/**
 * npm ci without / out-of-sync lockfile — Cause B. Benign + non-attributable:
 * the install stage's `npm install` fallback re-solves the tree, and re-syncing
 * the lockfile after the edit closes it. A lockfile-drift `EUSAGE` is NEVER a
 * verdict on whether the dependency edit was correct.
 */
const LOCKFILE_PATTERNS = [
  /can only install (?:packages )?with(?: your)? .*package-lock/i,
  /`npm ci` can only install/i,
  /can only install .* when your package\.json and package-lock/i,
  /lock file'?s? .* does not satisfy/i,
  /\bEUSAGE\b/i,
];

/**
 * 0035/D1 — the test runner is not installed / not importable by the chosen
 * interpreter (`No module named pytest`, `pytest: command not found`). A
 * capability gap of the harness ENVIRONMENT, never a verdict on the edit → the
 * applied edit is `blocked`, not `broken`. Distinct from a network `environment`
 * so the report can name the real gap ("test runner unavailable" ≠ "registry down").
 */
const MISSING_TOOL_PATTERNS = [
  /No module named ['"]?pytest['"]?/i,
  /pytest: command not found/i,
  /command not found: ?pytest/i,
  /\bunittest\b[^\n]*No module named/i,
];

/**
 * 0035/D1 — the suite collected nothing (pytest exit 5 wording, `no tests ran`,
 * `collected 0 items`). A test-less suite is a benign no-op, never a regression
 * → `blocked`/skip, not `broken`. This is the classifier's honest label for the
 * case A1's exit-5 no-op gate is meant to catch up front; it exists as a backstop
 * for a lane that surfaces "no tests" via output text rather than exit code 5.
 */
const NO_TESTS_PATTERNS = [
  /\bno tests ran\b/i,
  /\bno tests collected\b/i,
  /\bcollected 0 items\b/i,
];

/**
 * The edit's OWN fault: a version / peer conflict that a correct pipeline must
 * surface as `broken`, never mask as benign. Checked FIRST so an attributable
 * failure can never be swallowed by a co-occurring benign signal.
 */
const CONFLICT_PATTERNS = [
  /\bERESOLVE\b/i,
  /could not resolve dependency/i,
  /conflicting peer dependenc/i,
  /peer .* from/i,
  /no matching version found for/i,
  /notarget/i,
];

/** Priority order — an attributable conflict outranks any benign explanation. */
const PRIORITY = ["dependency-conflict", "environment", "toolchain", "missing-tool", "no-tests", "lockfile-drift"];

/** Causes that are NOT the remediation's fault → the applied edit is `blocked`. */
export const BENIGN_CAUSES = new Set(["environment", "toolchain", "lockfile-drift", "pre-existing", "missing-tool", "no-tests"]);
/** Causes the edit itself introduced → the applied edit is `broken`. */
export const ATTRIBUTABLE_CAUSES = new Set(["dependency-conflict"]);

export const isBenignCause = (cause) => BENIGN_CAUSES.has(cause);
export const isAttributableCause = (cause) => ATTRIBUTABLE_CAUSES.has(cause);

/**
 * Classify one blob of failure output into a single cause label, or null when
 * nothing matches. Conflict wins over every benign signal (never mask the
 * edit's own fault); otherwise environment > toolchain > lockfile-drift.
 * @param {string} text stdout and/or stderr of a failed step
 * @returns {"dependency-conflict"|"environment"|"toolchain"|"missing-tool"|"no-tests"|"lockfile-drift"|null}
 */
export function classifyFailureText(text) {
  const s = typeof text === "string" ? text : "";
  if (s.length === 0) return null;
  if (CONFLICT_PATTERNS.some((re) => re.test(s))) return "dependency-conflict";
  if (ENVIRONMENT_PATTERNS.some((re) => re.test(s))) return "environment";
  if (TOOLCHAIN_PATTERNS.some((re) => re.test(s))) return "toolchain";
  if (MISSING_TOOL_PATTERNS.some((re) => re.test(s))) return "missing-tool";
  if (NO_TESTS_PATTERNS.some((re) => re.test(s))) return "no-tests";
  if (LOCKFILE_PATTERNS.some((re) => re.test(s))) return "lockfile-drift";
  return null;
}

/**
 * Reduce a set of already-classified cause labels to the single
 * highest-priority one (a conflict anywhere dominates), or null when empty.
 * @param {Array<string|null>} causes
 */
export function pickCause(causes) {
  const found = new Set((Array.isArray(causes) ? causes : []).filter(Boolean));
  for (const p of PRIORITY) if (found.has(p)) return p;
  // A recorded-but-unranked benign label (e.g. explicit "pre-existing").
  for (const c of found) if (BENIGN_CAUSES.has(c)) return c;
  return found.size > 0 ? [...found][0] : null;
}

/**
 * Classify an array of failure-output blobs and return the dominant cause.
 * @param {Array<string>} texts
 */
export function diagnoseTexts(texts) {
  return pickCause((Array.isArray(texts) ? texts : []).map((t) => classifyFailureText(t)));
}

/**
 * 0054/D2 — the repeated-`environment` circuit breaker, as a PURE reducer over
 * cause labels (no clock, no I/O — it belongs here, beside the taxonomy it
 * counts, not in the stage loop that threads it).
 *
 * D1's preflight catches a registry that is down AT THE START; A3's retry cap
 * bounds each command's worst case. This catches the general case NEITHER can
 * see: a systemic fault that only manifests once execution begins (the registry
 * dies mid-run, the disk fills, a proxy starts refusing, credentials expire).
 * Count CONSECUTIVE steps failing with the SAME cause; at `threshold` (default
 * 3) the breaker opens and the stage short-circuits every remaining step.
 *
 * Per-cause and per-stage, and it RESETS on any success — so one flaky repo can
 * never trip it, only a repeating systemic fault. `threshold: 0` disables it
 * (deliberate soak runs). The open state is bounded by construction: once open
 * it stays open and the stage completes immediately (platform rule 4).
 *
 * @param {{threshold?: number}} [opts]
 */
export function createCauseBreaker({ threshold = 3 } = {}) {
  const limit = Number.isInteger(threshold) && threshold > 0 ? threshold : 0;
  let cause = null;
  let streak = 0;
  let open = null;
  return {
    get open() {
      return open;
    },
    get streak() {
      return streak;
    },
    /**
     * Observe one settled step. `{ ok, cause }` — a success (or a failure whose
     * cause is unclassifiable, i.e. not a KNOWN systemic fault) resets the run.
     * @returns {string|null} the cause the breaker just opened on, else null
     */
    observe({ ok, cause: stepCause } = {}) {
      if (limit === 0 || open) return null;
      if (ok !== false || !stepCause) {
        cause = null;
        streak = 0;
        return null;
      }
      streak = stepCause === cause ? streak + 1 : 1;
      cause = stepCause;
      if (streak >= limit) {
        open = stepCause;
        return open;
      }
      return null;
    },
  };
}

/** Human-readable one-liner for a cause (report reasons + decision log). */
export function describeCause(cause) {
  switch (cause) {
    case "environment":
      return "environment: package registry unreachable (offline / registry down)";
    case "toolchain":
      return "pre-existing toolchain/config break, independent of the dependency edit";
    case "lockfile-drift":
      return "lockfile out of sync after the edit (install fallback re-solves; re-sync closes it)";
    case "pre-existing":
      return "pre-existing failure present before the edit";
    case "missing-tool":
      return "test runner unavailable in this environment (e.g. pytest not importable), independent of the edit";
    case "no-tests":
      return "no tests were collected (a test-less suite) — a benign no-op, not a regression";
    case "dependency-conflict":
      return "dependency/version conflict introduced by the edit";
    default:
      return "unclassified failure";
  }
}
