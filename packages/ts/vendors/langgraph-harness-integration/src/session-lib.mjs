/**
 * src/session-lib.mjs — the pure, prompt-free half of the session gate
 * (change record `0024`/D1). `steps/session.mjs` is a thin prompt shim over this,
 * exactly as `steps/ingest-source.mjs` is over `src/ingest-lanes.mjs`.
 *
 * A SESSION is a run-scoped directory interposed between the project's `.harness/`
 * root and every artifact a run writes:
 *
 *   .harness/<SESSION_ID>/{repos,snapshots,dependency-graphs,.venv}/…
 *   .harness/<SESSION_ID>/{fingerprints,integrated,dependency-graph}.json
 *
 * `.harness` stops being the artifact root and becomes the CONTAINER OF SESSIONS,
 * so two consecutive `make start` runs no longer overwrite each other in place.
 * Re-entering an existing id finds its clones already on disk, and the clone
 * stage's `on_exist: skip` makes a resumed session cheap rather than a re-clone.
 *
 * WHY THE ID IS A CANONICAL UUID AND NOT A FREE SLUG. The value is concatenated
 * into a filesystem path (`resolve(cwd, ".harness", id)`), so `../../etc` or an
 * absolute path would escape the harness root. The UUID grammar structurally
 * excludes `/`, `\`, and `.` — the traversal is impossible, not merely unlikely,
 * which is the filesystem analogue of security rule §4's argv-list discipline.
 * `isValidSessionId` is therefore a PATH-TRAVERSAL GUARD, not a cosmetic check:
 * loosening the id shape (0024, open item 4) makes it load-bearing on its own.
 *
 * The id is a run selector, not a credential — security rule §5 is not engaged,
 * and it is safe to print in the confirm summary, the report, and logs.
 */
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

/** The per-project container of sessions, resolved against the RENDER BASE (below). */
export const HARNESS_ROOT = ".harness";

/** Canonical UUID — the only accepted session-id shape (see the module header). */
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RENDER PATH SEAM.
 *
 * Two knobs decide where a run's `.harness/` tree materializes, each settable by
 * ARG (wins) or ENV (falls back), with a cwd/pack-derived default when neither is
 * set:
 *
 *   --harness-render-root <dir>     $HARNESS_RENDER_ROOT     default: invocation cwd
 *   --harness-render-package <name> $HARNESS_RENDER_PACKAGE  default: basename(pkgDir)
 *
 * The BASE is the directory that CONTAINS `.harness/` — not `.harness/` itself —
 * so the container-of-sessions invariant (`<base>/.harness/<SESSION_ID>/`) holds
 * however the base was chosen. The PACKAGE segment names the vendored pack whose
 * artifacts are being rendered, giving each pack a private, session-scoped tree:
 *
 *   <base>/.harness/<SESSION_ID>/<package>/.harness/…
 *
 * WHY THE PACKAGE SEGMENT EXISTS. This pack is *vendored* — it lives under
 * `harness-repo-package-remediation/vendors/langgraph-harness-integration/`, but the user runs it from
 * `harness-repo-package-remediation/`. Artifacts whose path fell back to a pack-relative default (the
 * `../../.harness/<id>` sentinels in `flow-plan.mjs`, resolved against the
 * materialized yaml in `<pack>/.runs/wizard/`) therefore landed INSIDE the vendor
 * directory while every wizard-set path landed under the invocation cwd — one run,
 * two scattered `.harness/` trees. Rendering the pack's tree at
 * `<session>/<package>/.harness` keeps it session-scoped (so a resume finds it and
 * `rm -rf <session>` still clears everything) while preserving the pack ownership
 * the vendor-local path used to express.
 */

/**
 * A single path SEGMENT — no separators, no `.`/`..`, no drive letters. Same
 * discipline as `SESSION_ID_RE`: the package name is concatenated into a
 * filesystem path, so traversal is excluded structurally rather than by policy.
 */
const PACKAGE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Read `--flag <value>` or `--flag=<value>` out of an argv array. Last occurrence
 * wins (a later flag overrides an earlier one, as CLI convention expects).
 * @param {string[]} argv
 * @param {string} flag e.g. `--harness-render-root`
 * @returns {string|null} the value, or null when the flag is absent/valueless
 */
function readFlag(argv, flag) {
  let found = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === flag) {
      const next = argv[i + 1];
      // A trailing `--flag` with no value is a user error, not a silent empty
      // string that would resolve to the cwd — leave it null so the ENV/default
      // rung answers instead.
      if (typeof next === "string" && next !== "" && !next.startsWith("--")) found = next;
    } else if (token?.startsWith(`${flag}=`)) {
      const value = token.slice(flag.length + 1);
      if (value !== "") found = value;
    }
  }
  return found;
}

/**
 * Resolve the RENDER BASE — the directory that contains `.harness/`.
 * Precedence: `--harness-render-root` > `$HARNESS_RENDER_ROOT` > `cwd`.
 * A relative value resolves against `cwd`, so `--harness-render-root ..` means
 * "one level up from where I ran this", and an absolute value is taken as-is.
 * @param {{cwd: string, argv?: string[], env?: Record<string, string|undefined>}} opts
 * @returns {string} absolute path to the base directory
 */
export function resolveRenderRoot({ cwd, argv = [], env = process.env }) {
  const raw = readFlag(argv, "--harness-render-root") ?? env.HARNESS_RENDER_ROOT ?? null;
  return raw ? resolve(cwd, raw) : cwd;
}

/**
 * Resolve the PACKAGE segment naming the pack whose artifacts are rendered.
 * Precedence: `--harness-render-package` > `$HARNESS_RENDER_PACKAGE` > `basename(pkgDir)`.
 * @param {{pkgDir: string, argv?: string[], env?: Record<string, string|undefined>}} opts
 * @returns {string} a validated single path segment
 * @throws {Error} when the resolved name is not a single, traversal-free segment
 */
export function resolveRenderPackage({ pkgDir, argv = [], env = process.env }) {
  const name = readFlag(argv, "--harness-render-package") ?? env.HARNESS_RENDER_PACKAGE ?? basename(pkgDir);
  if (!PACKAGE_SEGMENT_RE.test(name)) {
    throw new Error(
      `Invalid render package '${name}' — expected a single path segment matching ${PACKAGE_SEGMENT_RE} ` +
        "(--harness-render-package / $HARNESS_RENDER_PACKAGE)",
    );
  }
  return name;
}

/**
 * The pack's private, session-scoped `.harness` tree: `<sessionDir>/<package>/.harness`.
 * Derived from the session dir rather than re-derived from the base, so a pinned
 * `ctx.plan.sessionDir` and the pack tree can never disagree about which session
 * they belong to.
 * @param {string} sessionDir an absolute session dir (see `sessionDirFor`)
 * @param {string} pkg a validated package segment (see `resolveRenderPackage`)
 * @returns {string} absolute path to the pack's render root
 * @throws {Error} when `pkg` is not a single, traversal-free segment
 */
export function packRenderDirIn(sessionDir, pkg) {
  if (!PACKAGE_SEGMENT_RE.test(pkg ?? "")) {
    throw new Error(`Invalid render package '${pkg}' — expected a single path segment matching ${PACKAGE_SEGMENT_RE}`);
  }
  return resolve(sessionDir, pkg, HARNESS_ROOT);
}

/**
 * Mint a fresh session id. `node:crypto`'s `randomUUID`, never `Math.random`.
 * @returns {string} a canonical v4 UUID
 */
export function mintSessionId() {
  return randomUUID();
}

/**
 * Path-traversal guard: is `id` a canonical UUID, and therefore safe to
 * concatenate into a filesystem path?
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidSessionId(id) {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}

/**
 * Resolve the run-scoped artifact root for `id` under `base`'s `.harness/`.
 * Throws rather than resolving an unvalidated id — a caller that skipped the
 * guard must not silently get a path outside the harness root.
 * @param {string} base the render base (see `resolveRenderRoot`); the invocation
 *   cwd when neither the ARG nor the ENV knob is set
 * @param {string} id a validated session id
 * @returns {string} absolute path to `<base>/.harness/<id>`
 * @throws {Error} when `id` fails `isValidSessionId`
 */
export function sessionDirFor(base, id) {
  if (!isValidSessionId(id)) {
    throw new Error(`Invalid session id '${id}' — expected a canonical UUID (e.g. ${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)})`);
  }
  return resolve(base, HARNESS_ROOT, id);
}

/**
 * The session ids already present under `cwd`'s `.harness/`, sorted. A missing
 * (or unreadable) `.harness/` is an empty list, not an error — the first run of
 * a fresh project has no sessions and must not fail here. Non-UUID entries are
 * ignored, which also filters the legacy flat artifacts (`fingerprints.json`,
 * `repos/`, `snapshots/`) a pre-`0024` run left behind.
 * @param {string} base the render base (see `resolveRenderRoot`)
 * @returns {string[]} session ids, ascending
 */
export function listSessions(base) {
  try {
    return readdirSync(resolve(base, HARNESS_ROOT), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isValidSessionId(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
