/**
 * src/bump.mjs — classify a version change as major / minor / patch.
 *
 * THE DATA LAYER OWNS THIS, not the React tree. A bump level is a fact ABOUT the change, derived
 * from two real channel values (`remediations[].from` / `.to`), so it is stamped onto the data in
 * `data.mjs` and rides into the page in the JSON island. The report renders it; it does not compute
 * it (`.claude/skills/html-report-data-contract`: *"if the answer is 'I computed it', it belongs in
 * data.mjs derived from a channel"*).
 *
 * IT IS NOT A SEMVER LIBRARY, and must not become one. It answers exactly one question — *how big is
 * this move?* — across every ecosystem the pipeline remediates (npm, pip, maven), whose version
 * strings agree on far less than you would like:
 *
 *   npm    ^4.18.0 → ^4.19.2     a RANGE, not a version. Real data; see the note below.
 *   maven  2.14.1  → 2.17.1
 *   pip    3.1.0   → 3.1.3
 *
 * THE RANGE OPERATOR IS THE TRAP. `remediations[].from` is whatever was written in the manifest, and
 * for npm that is routinely a constraint (`^4.18.0`), not a bare version. Parsing `^4.18.0` as a
 * number yields `NaN`, and a NaN comparator silently classifies every npm range change as `unknown`
 * — the same class of bug as the NaN severity comparator record 0057/F4 fixed. So the operator is
 * stripped before the comparison, and `bump.test.mjs` pins the real strings from a recorded run.
 *
 * IT NEVER GUESSES. A version it cannot parse (`latest`, `?`, a git sha, a docker tag) is `unknown`,
 * never `patch` — a fabricated level is worse than an absent one, because a reader would act on it
 * (record 0041/D1: substantive facts come from real channels; nothing here may invent one).
 */

/** The vocabulary. `downgrade` and `same` are real outcomes of a remediation, not error states. */
export const BUMP_LEVELS = ["major", "minor", "patch", "downgrade", "same", "unknown"];

/**
 * Strip everything that is not the version itself: a range operator (`^ ~ >= <= = > <`), a leading
 * `v`, whitespace. What remains is the version core plus any prerelease/build suffix.
 */
function normalize(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^[\^~><=!\s]+/, "").replace(/^v(?=\d)/i, "");
}

/** The leading numeric components — `1.2.3-rc1+b5` → `[1, 2, 3]`. `null` when there are none. */
function core(value) {
  const head = normalize(value).split(/[-+]/)[0];
  if (head === "") return null;
  const parts = head.split(".");
  const nums = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) break;
    nums.push(Number(p));
  }
  return nums.length ? nums : null;
}

/**
 * How big is the move from `from` to `to`?
 *
 * Position decides: the first component that differs names the level (0 → major, 1 → minor, 2+ →
 * patch), which is the semver reading and is also how npm, pip and maven users all read a version
 * in practice. Shorter versions are zero-padded, so `1.2` → `1.2.3` is a patch.
 *
 * @param {unknown} from the version (or range) that was there
 * @param {unknown} to   the version (or range) that was written
 * @returns {string} one of `BUMP_LEVELS`
 */
export function bumpLevel(from, to) {
  const a = core(from);
  const b = core(to);
  if (!a || !b) return "unknown";

  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x === y) continue;
    if (y < x) return "downgrade";
    return i === 0 ? "major" : i === 1 ? "minor" : "patch";
  }

  // Numerically identical. Either it really is the same version, or the two differ only in a
  // prerelease/build suffix (`1.2.3-rc1` → `1.2.3`) — a move semver gives no bump level to, and one
  // this function will not invent. `unknown` is the honest answer; `patch` would be a guess.
  return normalize(from) === normalize(to) ? "same" : "unknown";
}
