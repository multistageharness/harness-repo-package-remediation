/**
 * src/derive.mjs — deterministic derivations (no clock, no random).
 *
 * Where a real channel does not carry a field the design surfaces (per-line stage
 * log timestamps, per-stage wall-clock, checkout meta), the value is DERIVED from
 * the run's stable identifiers via FNV-1a — never a clock, never `Math.random()`.
 * That is what keeps the renderer pure: the same state renders byte-identical HTML,
 * which is what makes the golden replay gate (record 0055/D2) possible at all.
 *
 * These derivations are COSMETIC-ONLY. Substantive facts — vulnerabilities, plan
 * actions, outcomes, the prompt, stage pass/fail, the dependency graph — always come
 * from the real channels (record 0041/D1).
 *
 * Moved verbatim from the pack's `html-report-lib.mjs:90-101` (record 0055/D1).
 */

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export const rnd = (seed, lo, hi) => lo + (hash(seed) % (hi - lo + 1));
export const sha = (seed) => hash(seed).toString(16).padStart(8, "0") + hash(seed + "x").toString(16).padStart(8, "0");
export const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`);
export const clock = (base, offset) => new Date(base + offset).toISOString().slice(11, 23);
