/**
 * src/report-migrations.mjs — versioned-artifact migration framework for the
 * harness-side fingerprint entry `{ url, dir, fingerprint, dependencies,
 * artifactVersion }` (renovate-harness-enhancements Epic 02, story 02/02/02;
 * record 0019/D1). `.harness/fingerprints.json` artifacts already exist on
 * disk in pre-`dependencies` shapes and the shape keeps evolving — Renovate's
 * AbstractMigration chain translated to this codebase's plain-function style:
 * an ordered MIGRATIONS list walked by `normalizeFingerprintEntry` before an
 * entry reaches any consumer. Versions the HARNESS entry, never the vendored
 * Detection Report inside `entry.fingerprint` (pristine-mirror schema).
 */

/** Assign only when the key is currently null/undefined (Renovate setSafely). */
export function setSafely(obj, key, value) {
  if (obj[key] === null || obj[key] === undefined) obj[key] = value;
  return obj;
}

/** Move a key: setSafely to `to`, then delete `from` (Renovate rename move). */
export function renameKey(obj, from, to) {
  if (from in obj) {
    setSafely(obj, to, obj[from]);
    delete obj[from];
  }
  return obj;
}

/** Ordered migration chain — each entry advances one artifact version. */
export const MIGRATIONS = [
  {
    name: "add-dependencies-array",
    fromVersion: "1.0",
    toVersion: "1.1",
    run(entry) {
      // setSafely semantics: never overwrites a populated dependencies array.
      setSafely(entry, "dependencies", []);
      return entry;
    },
  },
];

/** Single source of truth for the stamp on freshly-created entries. */
export const CURRENT_ARTIFACT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].toVersion;

/**
 * Walk the chain from `entry.artifactVersion ?? "1.0"`, applying each matching
 * migration and advancing the version; stamp the final version. Unknown or
 * future versions pass through untouched with the version preserved
 * (graceful-degrade, mirroring Renovate's unknown-id fallback).
 */
export function normalizeFingerprintEntry(entry) {
  if (entry === null || typeof entry !== "object") return entry;
  let version = entry.artifactVersion ?? "1.0";
  for (const migration of MIGRATIONS) {
    if (migration.fromVersion !== version) continue;
    migration.run(entry);
    version = migration.toVersion;
  }
  entry.artifactVersion = version;
  return entry;
}
