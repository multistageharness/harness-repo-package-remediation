/**
 * src/registry-lookup.mjs — mock-first "what versions exist for package X"
 * primitive (Epic 03, story 03/01/01; record 0019/D2), Renovate's
 * `Datasource.getReleases` discipline: a version is never a bare string but a
 * `Release` record with provenance — and `releaseTimestamp` is MANDATORY from
 * day one (finding 07B) so a future `minimumReleaseAge` supply-chain cooldown
 * is a filter, not a schema change.
 *
 * Mock path: zero HTTP — a deterministic synthetic release list derived from
 * the package name. Real path: fetch through an injectable `fetchImpl` seam
 * (tests stay fully offline); 404 → null ("package unknown" is not an error —
 * Renovate's convention), 429/5xx → throw with `retryable: true` (Epic 01's
 * classification convention carried over), other non-OK → fatal throw.
 */

const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

/**
 * Deterministic mock releases: `1.0.0 … 1.<n>.0` with `n = 3 + (name.length
 * % 3)`, plus a `99.0.0` ceiling so any fixture manifest has "something newer
 * to bump to". Timestamps are fixed synthetic dates — never wall-clock.
 */
export function mockReleases(packageName) {
  const name = String(packageName ?? "");
  const n = 3 + (name.length % 3);
  const releases = [];
  for (let i = 0; i <= n; i += 1) {
    releases.push({ version: `1.${i}.0`, releaseTimestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, isDeprecated: false });
  }
  releases.push({ version: "99.0.0", releaseTimestamp: "2026-02-01T00:00:00.000Z", isDeprecated: false });
  return releases;
}

/**
 * Look up a package's releases. Returns `{ releases, registryUrl }`, or null
 * when the package is unknown (404).
 */
export async function getReleases({ packageName, registryUrl } = {}, ctx, fetchImpl = globalThis.fetch) {
  const base = registryUrl ?? DEFAULT_REGISTRY;
  if (ctx?.options?.mock) {
    return { releases: mockReleases(packageName), registryUrl: base };
  }

  const url = new URL(encodeURIComponent(String(packageName)), base);
  const res = await fetchImpl(url);
  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    throw Object.assign(new Error(`registry-lookup: ${res.status} for ${packageName}`), { retryable: true });
  }
  if (!res.ok) {
    throw new Error(`registry-lookup: ${res.status} for ${packageName}`);
  }
  const doc = await res.json();
  const time = doc?.time ?? {};
  const releases = Object.entries(doc?.versions ?? {}).map(([version, meta]) => ({
    version,
    releaseTimestamp: time?.[version] ?? null,
    isDeprecated: Boolean(meta?.deprecated),
  }));
  return { releases, registryUrl: base };
}
