/**
 * src/versioning-ext.mjs — tolerant dotted-numeric version comparison for the
 * NON-npm ecosystems the target ladder now serves (change record 0032/A4/D4,
 * amended by 0037/A1/A2/A4).
 *
 * `versioning-npm.mjs` is strict x.y.z by design. Maven coordinates
 * (`2.17.1`, `31.1-jre`), PEP 440 releases (`3.1.4`, `1.0.0.post1`), and other
 * dotted-numeric tokens need ordering for exactly two ladder questions — "is
 * the target greater than the current?" and "is the candidate greater than the
 * floor?" — so this module implements just that: segment-wise numeric
 * comparison over dotted tokens of ANY length, plus a QUALIFIER-CLASS ladder.
 *
 * QUALIFIER CLASSES (0037/A1, superseding 0032/A4/D4's "any alphabetic suffix
 * orders BELOW its bare release"). That rule is right for `-rc1`/`-alpha` and
 * WRONG for post-releases: PEP 440 says `1.0.0.post1` is NEWER than `1.0.0`.
 * Ordering, low to high:
 *
 *   dev < alpha|a < beta|b < milestone|m < rc|c|cr|pre|preview < snapshot
 *       < (bare release)|final|ga|release < post|rev|r|sp < (unknown tail)
 *
 * with the qualifier's NUMERIC suffix compared numerically, so `rc2 < rc10`
 * (0037/A4 — the old lexicographic tail put `rc2` above `rc10`). An unknown
 * tail (`-jre`, `-android`) sorts above the bare release and lexicographically
 * among its peers: Maven's own rule for unrecognized qualifiers, and the only
 * total order available for a variant classifier.
 *
 * STABILITY IS ECOSYSTEM-ASYMMETRIC (0037/A2). An alphabetic tail is not
 * evidence of a prerelease — `31.1-jre` is Guava's only release coordinate.
 * Only the classes below the bare release are prereleases. For the UNKNOWN
 * tail the two ecosystems disagree, so they get two predicates:
 *   - `isStableMaven`   — unknown ⇒ STABLE. A classifier (`-jre`, `-android`,
 *     `.Final`) is far more common than an unrecognized prerelease word.
 *   - `isStablePep440`  — unknown ⇒ UNSTABLE. PEP 440 enumerates its
 *     prerelease spellings, so anything unrecognized is not a release.
 *
 * NON-GOAL (0037/D4). Renovate's `semver` / `semver-coerced` / `semver-partial`
 * / `same-major` schemes are deliberately NOT ported here: `semver` is already
 * `versioning-npm.mjs`, `semver-coerced` is ~90% this file, `semver-partial`
 * serves a lane we do not have, and `same-major` needs a range evaluator that
 * `versioning-npm.mjs` deliberately lacks — deferred until a ladder rung
 * requires a major boundary. `.ai/research/scan/versioning/*` is Renovate
 * source under AGPL-3.0-or-later, living in a separate repo: any grammar here
 * is REIMPLEMENTED from its `readme.md` and spec table, never copied from
 * `index.ts`.
 *
 * This is deliberately NOT a full Maven ComparableVersion or PEP 440
 * implementation — unparseable input returns false/0, never a throw, and
 * callers treat "not comparable" as "not eligible". PEP 440 local versions
 * (`1.0.0+local`) do not parse and are therefore never candidates.
 */

const DOTTED_RE = /^v?(\d+(?:\.\d+)*)([.-]?[0-9A-Za-z.-]*)$/;

/** A qualifier's alphabetic word and its optional numeric suffix (`rc10` → `rc`, `10`). */
const QUALIFIER_RE = /^([a-z]*)[._-]?(\d*)$/;

/** Qualifier word → class rank. Lower ranks order below higher ones. */
const QUALIFIER_CLASSES = new Map([
  ["dev", 0],
  ["alpha", 1],
  ["a", 1],
  ["beta", 2],
  ["b", 2],
  ["milestone", 3],
  ["m", 3],
  ["rc", 4],
  ["c", 4],
  ["cr", 4],
  ["pre", 4],
  ["preview", 4],
  ["snapshot", 5],
  ["", 6],
  ["final", 6],
  ["ga", 6],
  ["release", 6],
  ["post", 7],
  ["rev", 7],
  ["r", 7],
  ["sp", 7],
]);

/** The bare release's class. Anything below it is a prerelease. */
const RELEASE_CLASS = 6;

/** Unrecognized tails (`jre`, `android`) — above every known class, per Maven. */
const UNKNOWN_CLASS = 8;

/** Parse a dotted-numeric token → { nums: number[], qualifier: string } | null. */
export function parseDotted(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(DOTTED_RE);
  if (!m || m[1] === undefined) return null;
  const qualifier = (m[2] ?? "").replace(/^[.-]/, "").toLowerCase();
  return { nums: m[1].split(".").map(Number), qualifier };
}

/**
 * Classify a qualifier tail → `{ rank, word, num, known }` (0037/A1).
 * A bare release is `{rank: 6, word: "", num: 0, known: true}`; a trailing
 * build number (`1.0.0-1`) is the same class with `num: 1`, so it orders above
 * its bare release exactly as Maven has it.
 */
export function classifyQualifier(qualifier) {
  const m = String(qualifier).match(QUALIFIER_RE);
  if (m === null) return { rank: UNKNOWN_CLASS, word: String(qualifier), num: 0, known: false };
  const word = m[1];
  const num = m[2] === "" ? 0 : Number(m[2]);
  const rank = QUALIFIER_CLASSES.get(word);
  if (rank === undefined) return { rank: UNKNOWN_CLASS, word, num, known: false };
  return { rank, word, num, known: true };
}

/** Is `value` a dotted-numeric version token (qualifier allowed)? */
export function isDottedVersion(value) {
  return parseDotted(value) !== null;
}

/** Comparator over dotted tokens: <0, 0, >0. Unparseable input → 0. */
export function compareDotted(a, b) {
  const pa = parseDotted(a);
  const pb = parseDotted(b);
  if (pa === null || pb === null) return 0;
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i += 1) {
    const na = pa.nums[i] ?? 0;
    const nb = pb.nums[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  // Equal numeric cores → the qualifier CLASS decides (0037/A1), then its
  // numeric suffix NUMERICALLY (0037/A4), then unknown tails lexicographically.
  const qa = classifyQualifier(pa.qualifier);
  const qb = classifyQualifier(pb.qualifier);
  if (qa.rank !== qb.rank) return qa.rank - qb.rank;
  if (!qa.known && qa.word !== qb.word) return qa.word < qb.word ? -1 : 1;
  return qa.num - qb.num;
}

/** True when `a` orders strictly after `b`; false when either is unparseable. */
export function isGreaterDotted(a, b) {
  if (parseDotted(a) === null || parseDotted(b) === null) return false;
  return compareDotted(a, b) > 0;
}

/**
 * PEP 440 stability (pip / poetry / uv / conda): releases and post-releases are
 * stable; every prerelease class — and every UNRECOGNIZED tail — is not.
 */
export function isStablePep440(value) {
  const parsed = parseDotted(value);
  if (parsed === null) return false;
  const q = classifyQualifier(parsed.qualifier);
  return q.known && q.rank >= RELEASE_CLASS;
}

/**
 * Maven stability: releases, post-releases, and VARIANT CLASSIFIERS are stable
 * (`31.1-jre`, `31.1-android`, `2.17.1.Final`); only the known prerelease
 * classes — including `-SNAPSHOT` — are not.
 */
export function isStableMaven(value) {
  const parsed = parseDotted(value);
  if (parsed === null) return false;
  const q = classifyQualifier(parsed.qualifier);
  return !q.known || q.rank >= RELEASE_CLASS;
}
