/**
 * matchEcosystem — tri-state policy matcher (Epic 04, story 04/01/01; record
 * 0019/D3). The tri-state law (Renovate package-rules/base.ts): `null` means
 * the rule has NO OPINION on this field (rule key absent) — NOT "no match";
 * a present rule key with a missing input field is a hard `false`; otherwise
 * the predicate result. Pure function, never throws on any input shape.
 */
export function matchEcosystem(input, rule) {
  if (rule?.matchEcosystem === undefined) return null;
  const eco = input?.dominantEcosystem ?? input?.ecosystem ?? null;
  if (!eco) return false;
  return Array.isArray(rule.matchEcosystem) && rule.matchEcosystem.includes(eco);
}
