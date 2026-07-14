/**
 * matchConfidence — tri-state policy matcher (Epic 04, story 04/01/01; record
 * 0019/D3) over the fingerprint confidence buckets, ordered
 * none < low < medium < high < certain (confidence is just another matcher
 * field — Renovate package-rules/merge-confidence.ts, finding 07 §C).
 * Tri-state law: rule key absent → null (no opinion); missing/unknown input
 * bucket → false; else index comparison. Never throws.
 */
const ORDER = ["none", "low", "medium", "high", "certain"];

export function matchConfidence(input, rule) {
  if (rule?.matchConfidenceAtLeast === undefined) return null;
  const bucket = input?.confidenceBucket ?? null;
  const at = ORDER.indexOf(bucket);
  if (at === -1) return false;
  return at >= ORDER.indexOf(rule.matchConfidenceAtLeast);
}
