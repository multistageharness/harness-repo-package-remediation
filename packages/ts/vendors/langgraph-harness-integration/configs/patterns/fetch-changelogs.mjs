/**
 * commands.fetchChangelogs — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the changelog tail
 * stage (change record 0032/D6; next-steps NS3, modeled on Renovate's
 * changelog algorithm — resolve a source URL, collect the releases in the
 * update range, embed the result where the outcome is reported).
 *
 * For every APPLIED remediation `{package, from, to}` it emits one record:
 *   { repo, package, from, to, sourceUrl, compareUrl, releases[], note }
 * - `releases` — the registry versions inside `(from, to]`, with timestamps
 *   (the same lookup seam the remediate stage uses; offline-testable via the
 *   injected lookup, deterministic stub under --mock).
 * - `sourceUrl`/`compareUrl` — the npm registry's repository URL when the
 *   lookup response carries one, mapped to a GitHub compare link.
 * - Release-notes BODIES are explicitly out of v1 scope: fetching them from
 *   github.com requires a token (env-only, security rule 5) and is gated on
 *   the H4 PR decision — the record carries `note: "release notes not
 *   fetched"` rather than pretending. Skipped/unapplied remediations produce
 *   no changelog record (there is no version transition to explain).
 *
 * Mock-first (security rule 8): under `ctx.options.mock` the stage emits a
 * deterministic stub per applied record — zero network. Real-run lookups are
 * best-effort with `.catch(null)`; a lookup failure degrades to an empty
 * releases list with a note, never an abort. Bounded per platform rule 4 by
 * the remediations list it iterates.
 */

import { isVersion, isGreaterThan, sortVersions } from "../../src/versioning-npm.mjs";
import { getReleases } from "../../src/registry-lookup.mjs";

export const meta = {
  name: "commands.fetchChangelogs",
  category: "commands",
  summary: "Collect the release range (from..to] + source/compare URLs for every applied remediation — mock-first, best-effort, never gating.",
  params: {
    type: "object",
    required: ["remediations_from", "into"],
    properties: {
      remediations_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

/** Normalize a repository URL (git+https, git://, .git suffix) → https, or null. */
export function normalizeSourceUrl(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  const cleaned = url.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "");
  return /^https?:\/\//.test(cleaned) ? cleaned : null;
}

/** Test seam: build the factory over an injected registry lookup. */
export function _fetchChangelogsWith({ lookup = getReleases } = {}) {
  return function fetchChangelogsFactory(params, ctx) {
    return async (state) => {
      const remediations = Array.isArray(state[params.remediations_from]) ? state[params.remediations_from] : [];
      const applied = remediations.filter((r) => r?.applied === true && typeof r?.package === "string");
      const changelogs = [];
      const total = applied.length;
      let index = 0;
      for (const rem of applied) {
        index += 1;
        ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });
        const base = { repo: rem.repo ?? null, package: rem.package, from: rem.from ?? null, to: rem.to ?? null };
        if (ctx.options.mock) {
          changelogs.push({ ...base, sourceUrl: null, compareUrl: null, releases: [], note: "mock run" });
          continue;
        }
        const found = await lookup({ packageName: rem.package }, ctx).catch(() => null);
        const sourceUrl = normalizeSourceUrl(found?.sourceUrl ?? null);
        const bare = (v) => String(v ?? "").replace(/^(\^|~|>=|=|v)\s*/, "");
        const fromV = bare(rem.from);
        const toV = bare(rem.to);
        const releases = (found?.releases ?? [])
          .filter((r) => isVersion(r.version) && (!isVersion(fromV) || isGreaterThan(r.version, fromV)) && (!isVersion(toV) || !isGreaterThan(r.version, toV)))
          .sort((a, b) => sortVersions(a.version, b.version))
          .map((r) => ({ version: r.version, releaseTimestamp: r.releaseTimestamp ?? null }));
        changelogs.push({
          ...base,
          sourceUrl,
          compareUrl: sourceUrl && fromV && toV ? `${sourceUrl}/compare/v${fromV}...v${toV}` : null,
          releases,
          note: found === null ? "registry lookup unavailable" : "release notes not fetched (v1 — env-token gated, see 0032/D6)",
        });
      }
      return { [params.into]: changelogs };
    };
  };
}

export const fetchChangelogs = _fetchChangelogsWith({});
