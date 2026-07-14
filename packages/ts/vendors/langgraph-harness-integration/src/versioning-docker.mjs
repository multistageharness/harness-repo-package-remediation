/**
 * src/versioning-docker.mjs — variant-aware docker TAG grammar (change record
 * 0037/D1, replacing the `TAG_GRAMMAR` lexicographic fallback of 0033/D9 per
 * 0037/A3).
 *
 * Docker images have TAGS, not versions. The lexicographic fallback did not
 * merely mis-sort them: `rankCandidates` uses `isGreater` as an ELIGIBILITY
 * FILTER, so `"1.10" > "1.9"` being false as a string compare silently DROPPED
 * every correct in-major upgrade and left the engine proposing an eight-major
 * jump (`1.9 → 9.0`), while `9.0 → 10.0` reported "no upgrade available".
 *
 * Neither shortcut was safe, and both were measured: coercing to semver makes
 * `1.24-alpine` and `1.24-slim` compare EQUAL (the finder could swap image
 * variants), and the tolerant dotted grammar reads `-alpine` as a prerelease
 * qualifier, so `isStable("1.24-alpine")` is false and every variant tag is
 * filtered out of the candidate set.
 *
 * SEMANTICS. A tag is `<release>[<prerelease>][-<suffix>]`:
 *   - `release`    — dotted numeric, compared segment-wise. On an equal common
 *     prefix the SHORTER array is GREATER: `1.2` > `1.2.3`, because a user on
 *     `12.14` expects `12.15`, not `12.15.0`.
 *   - `prerelease` — an alphanumeric tail glued to the release (`3.8.0b1`).
 *     Orders below its bare release, and its numeric part compares NUMERICALLY
 *     (`b1 < b10`, never the `rc2 > rc10` bug of 0037/A4).
 *   - `suffix`     — everything after the FIRST hyphen (`-alpine`, `-slim`,
 *     `-slim-bullseye`). A platform/compatibility indicator, NOT an ordering
 *     key: it is EXCLUDED from `compare` and governs `isCompatible` instead.
 *
 * Tags shaped like a git commit hash (`0a1b2c3`) are not versions and never
 * parse — but an ALL-NUMERIC token that happens to be hex-shaped and 7-40 long
 * (`123098140293`) is a legitimate release and does.
 *
 * CLEAN-ROOM (0037/D4, binding). Reimplemented from the `readme.md` prose and
 * the behavior table in `index.spec.ts` under `.ai/research/scan/versioning/
 * docker/`. That tree is Renovate source, AGPL-3.0-or-later, in a separate
 * repo; its `index.ts` was never read into this file.
 */

/** A lowercase-hex token of git-hash length. Uppercase or non-hex ⇒ not a hash. */
const COMMIT_HASH_RE = /^[a-f0-9]{7,40}$/;

/** An all-numeric token is a release even when it is hex-shaped and hash-length. */
const ALL_DIGITS_RE = /^\d+$/;

/** `<release>[<prerelease>][-<suffix>]` — the suffix is everything after the first hyphen. */
const DOCKER_TAG_RE = /^(\d+(?:\.\d+)*)([a-zA-Z]\w*)?(?:-(.+))?$/;

/** Split a prerelease into its alphabetic word and numeric suffix (`b10` → `b`, `10`). */
const PRERELEASE_RE = /^([a-zA-Z]+)(\d+)$/;

/**
 * Parse a docker tag → `{ release: number[], prerelease: string, suffix: string }`,
 * or null when the tag is not a version (a rolling tag like `alpine`, a commit
 * hash, a digest reference). Never throws.
 */
export function parseDockerTag(tag) {
  if (typeof tag !== "string") return null;
  const trimmed = tag.trim();
  if (COMMIT_HASH_RE.test(trimmed) && !ALL_DIGITS_RE.test(trimmed)) return null;
  const m = trimmed.match(DOCKER_TAG_RE);
  if (m === null) return null;
  return { release: m[1].split(".").map(Number), prerelease: m[2] ?? "", suffix: m[3] ?? "" };
}

/** Is `tag` a comparable docker version tag? */
export function isDockerTag(tag) {
  return parseDockerTag(tag) !== null;
}

function compareRelease(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  // Equal common prefix → the SHORTER tag is the broader, newer rolling tag.
  return b.length - a.length;
}

function comparePrerelease(a, b) {
  if (a === b) return 0;
  if (a === "") return 1; // a bare release outranks any prerelease of itself
  if (b === "") return -1;
  const ma = a.match(PRERELEASE_RE);
  const mb = b.match(PRERELEASE_RE);
  if (ma !== null && mb !== null && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
  return a < b ? -1 : 1;
}

/** Ascending comparator over docker tags: <0, 0, >0. Unparseable input → 0. */
export function compareDockerTags(a, b) {
  const pa = parseDockerTag(a);
  const pb = parseDockerTag(b);
  if (pa === null || pb === null) return 0;
  const byRelease = compareRelease(pa.release, pb.release);
  if (byRelease !== 0) return byRelease;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True when `a` orders strictly after `b`; false when either is unparseable. */
export function isGreaterDockerTag(a, b) {
  if (parseDockerTag(a) === null || parseDockerTag(b) === null) return false;
  return compareDockerTags(a, b) > 0;
}

/** A tag is stable when it carries no prerelease. `-alpine` is a variant, not a prerelease. */
export function isStableDockerTag(tag) {
  const parsed = parseDockerTag(tag);
  return parsed !== null && parsed.prerelease === "";
}

/**
 * Can `a` be offered as an upgrade to `b`? Same variant suffix and same release
 * arity — so `1.24-alpine` is never offered to `1.24-slim`, and `1.24` never to
 * `1.24.0`.
 *
 * NOTE: `rankCandidates` does not consult this yet (0037/D1 note). It is the
 * follow-on that makes the variant guarantee real; until then the guarantee is
 * available to callers, not enforced by the engine.
 */
export function isCompatibleDockerTag(a, b) {
  const pa = parseDockerTag(a);
  const pb = parseDockerTag(b);
  if (pa === null || pb === null) return false;
  return pa.suffix === pb.suffix && pa.release.length === pb.release.length;
}

/** The 4-method grammar contract `rankCandidates` consumes, plus `isCompatible`. */
export const DOCKER_GRAMMAR = {
  isVersion: isDockerTag,
  isStable: isStableDockerTag,
  isGreater: isGreaterDockerTag,
  compare: compareDockerTags,
  isCompatible: isCompatibleDockerTag,
};
