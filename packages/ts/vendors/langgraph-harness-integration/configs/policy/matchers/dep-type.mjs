/**
 * matchDepType — tri-state policy matcher (Epic 04, story 04/01/01; record
 * 0019/D3). Tri-state law: rule key absent → null (no opinion — NOT "no
 * match"); present rule key with a missing input depType → false; else list
 * membership. Never throws.
 */
export function matchDepType(input, rule) {
  if (rule?.matchDepTypes === undefined) return null;
  const depType = input?.depType ?? null;
  if (!depType) return false;
  return Array.isArray(rule.matchDepTypes) && rule.matchDepTypes.includes(depType);
}
