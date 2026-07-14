/**
 * src/versioning-npm.mjs — hand-rolled, zero-dependency subset of Renovate's
 * VersioningApi over `major.minor.patch[-prerelease]` strings (Epic 03, story
 * 03/01/02; record 0019/D2). The repo bans dependency ranges and adds no new
 * packages (platform rule 8), so this is NOT the `semver` package — just
 * enough for "is the recommended version actually newer" and "pick the
 * highest stable release".
 *
 * Explicit NON-GOALS (by design, documented for the remediate atom):
 * - no range grammar (`^ ~ < > = * x`) — a range-shaped `currentValue`
 *   extracted from a third-party manifest simply fails `isVersion` and the
 *   caller records `skipReason: "unsupported version syntax"`, never guesses;
 * - no build-metadata (`+meta`) ordering;
 * - no coercion of partial versions (`1.2` is not a version).
 *
 * Pure string functions, zero imports; ill-formed input → false/null, never
 * a throw.
 */

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parse(s) {
  if (typeof s !== "string") return null;
  const m = s.replace(/^v/, "").match(VERSION_RE);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null };
}

/** Strict x.y.z with optional -prerelease; one leading `v` tolerated. */
export function isVersion(s) {
  return parse(s) !== null;
}

/** A parseable version with no prerelease tag. */
export function isStable(s) {
  const p = parse(s);
  return p !== null && p.prerelease === null;
}

/**
 * Comparator: numeric per core segment; equal cores order prerelease < none;
 * prerelease identifiers compare dot-segment-wise (numeric segments
 * numerically, mixed string-wise — semver §11 simplified). Unparseable sorts
 * first, stably.
 */
export function sortVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (pa === null && pb === null) return 0;
  if (pa === null) return -1;
  if (pb === null) return 1;
  for (const key of ["major", "minor", "patch"]) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key];
  }
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1; // release > its prereleases
  if (pb.prerelease === null) return -1;
  const as = pa.prerelease.split(".");
  const bs = pb.prerelease.split(".");
  for (let i = 0; i < Math.min(as.length, bs.length); i += 1) {
    const an = /^\d+$/.test(as[i]);
    const bn = /^\d+$/.test(bs[i]);
    if (an && bn) {
      if (Number(as[i]) !== Number(bs[i])) return Number(as[i]) - Number(bs[i]);
    } else if (as[i] !== bs[i]) {
      return as[i] < bs[i] ? -1 : 1;
    }
  }
  return as.length - bs.length;
}

/** True when `a` is a strictly newer version than `b`; false if either is unparseable. */
export function isGreaterThan(a, b) {
  if (parse(a) === null || parse(b) === null) return false;
  return sortVersions(a, b) > 0;
}

/** Exact equality after `v`-strip — no range grammar by design. */
export function matches(version, value) {
  const pv = parse(version);
  const pw = parse(value);
  if (pv === null || pw === null) return false;
  return sortVersions(version, value) === 0 && (pv.prerelease ?? "") === (pw.prerelease ?? "");
}

/** The version in `versions` exactly matching `value`, or null. */
export function getSatisfyingVersion(versions, value) {
  if (!Array.isArray(versions)) return null;
  return versions.find((v) => matches(v, value)) ?? null;
}

// ── getNewValue (change record 0032/A5) ─────────────────────────────────────
//
// The one VersioningApi method that CHANGES a constraint (Renovate
// versioning/npm/range.ts, ported as a strict zero-dependency subset). Before
// 0032 the remediate atom rejected any range-shaped `currentValue` outright
// (`unsupported version syntax`) — so `express@^4.18.0` could never take its
// advisory target. Now a single-operator range is REWRITTEN, preserving the
// author's operator: `^4.18.0` --bump 4.19.2--> `^4.19.2`.
//
// Supported constraint grammar (everything else returns null — the caller
// records the honest skip, never guesses):
//   <version>            exact (one leading `v` tolerated)
//   ^x.y.z  ~x.y.z       caret / tilde (operator preserved)
//   >=x.y.z  =x.y.z      floor / explicit-equals (operator preserved)
// Out of scope by design: x-ranges (1.2.x), wildcards (*), compound ranges
// (`||`, hyphen-ranges, space-separated comparators), and `<`/`<=` ceilings —
// rewriting those needs real range algebra, not operator preservation.

const SIMPLE_RANGE_RE = /^(\^|~|>=|=)\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Is `value` a constraint `getNewValue` knows how to rewrite? */
export function isRewritableConstraint(value) {
  return isVersion(value) || (typeof value === "string" && SIMPLE_RANGE_RE.test(value.trim()));
}

/**
 * Compute the rewritten constraint for `newVersion`, or null when the
 * current constraint is outside the supported grammar / inputs are invalid.
 * @param {{ currentValue: string, rangeStrategy?: "auto"|"pin"|"bump"|"replace",
 *           newVersion: string }} config
 * @returns {string|null}
 */
export function getNewValue({ currentValue, rangeStrategy = "auto", newVersion } = {}) {
  if (!isVersion(newVersion)) return null;
  if (typeof currentValue !== "string") return null;
  const current = currentValue.trim();
  if (rangeStrategy === "pin") return newVersion;
  if (isVersion(current)) {
    // exact stays exact; preserve a leading `v` if the author used one
    return current.startsWith("v") && !newVersion.startsWith("v") ? `v${newVersion}` : newVersion;
  }
  const m = current.match(SIMPLE_RANGE_RE);
  if (!m) return null;
  const operator = m[1];
  // `replace`: keep the constraint untouched when the target already satisfies
  // a caret/tilde/floor range whose base is <= target (bump raises the floor
  // regardless — the remediate ladder wants the floor raised, 0032/A4 rung 1).
  if (rangeStrategy === "replace") {
    const base = `${m[2]}.${m[3]}.${m[4]}${m[5] ? `-${m[5]}` : ""}`;
    const withinCaret = operator === "^" && Number(m[2]) === Number(newVersion.replace(/^v/, "").split(".")[0]) && !isGreaterThan(base, newVersion);
    if (withinCaret) return current;
  }
  return `${operator}${newVersion}`;
}
