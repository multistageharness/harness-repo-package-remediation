/**
 * matchRepoUrl — tri-state policy matcher (Epic 04, story 04/01/01; record
 * 0019/D3). Rule key `matchRepoUrls` is a list of `*`-globs, compiled by
 * escaping every regex special then substituting `*` → `.*`, anchored `^…$`
 * — no user-regex injection surface. Tri-state law: rule key absent → null
 * (no opinion); missing input repoUrl → false; else some-glob-matches. Never
 * throws.
 */
function globToRegex(glob) {
  const escaped = String(glob).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchRepoUrl(input, rule) {
  if (rule?.matchRepoUrls === undefined) return null;
  const url = input?.repoUrl ?? null;
  if (typeof url !== "string" || url.length === 0) return false;
  return Array.isArray(rule.matchRepoUrls) && rule.matchRepoUrls.some((glob) => globToRegex(glob).test(url));
}
