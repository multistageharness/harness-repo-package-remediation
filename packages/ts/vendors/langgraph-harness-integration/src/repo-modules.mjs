/**
 * src/repo-modules.mjs — deterministic module derivation from a repository
 * fingerprint (change record 0025/D2).
 *
 * A repo is not always ONE project. `.harness/fingerprints.json` already records
 * every `primary-manifest` signal with its exact relative path; until this module
 * existed that information was thrown away — `commands.depgraphExtract` read the
 * fingerprint and used only `entry.dir`, so a repo whose manifests all live below
 * the root had NO invocation that could succeed. (The record's source artifact:
 * 12 standalone poms under `use-cases`, no aggregator, `mvn` run at the clone
 * root → `MissingProjectException`, exit 1.)
 *
 * Pure and deterministic — no fs, no subprocess, no model. Derivation is aligned
 * with the pristine mirror's own confidence model
 * (`vendors/repository-fingerprint/schema/confidence-model.md:107` — "the
 * top-most nested directory that holds its own `primary-manifest` signal"), but
 * lives HERE rather than in that mirror, which stays pristine (platform rule 6).
 *
 * Three rules, in order:
 *   1. A ROOT manifest exists → one root module. A root `pom.xml` with
 *      `<modules>` is an aggregator and a root `settings.gradle` is a
 *      multi-project build: Maven and Gradle already fan out internally, so
 *      fanning out ourselves would be wrong. This is the load-bearing rule —
 *      it is what keeps every normal single-project repo on exactly today's
 *      code path.
 *   2. NO root manifest → one module per top-most `primary-manifest` path,
 *      skipping any whose ancestor directory also holds one.
 *   3. NO manifests at all (including a stub fingerprint under `--mock`) → one
 *      root module with a null manifest — byte-identical to pre-0025 behavior.
 */

import { ECOSYSTEM_GROUPS, ecosystemGroup } from "./ecosystem-registry.mjs";

/** The pre-0025 execution unit: the clone root, no `-f` target. Rules 1/3 floor. */
export const ROOT_MODULE = Object.freeze({ dir: ".", manifest: null });

/** Fingerprint paths are repo-relative and POSIX-ish; normalize defensively. */
function normalizePath(path) {
  return String(path).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Directory holding a manifest path — "." for a root manifest. */
function dirOf(path) {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "." : path.slice(0, cut);
}

/**
 * Filesystem-safe, collision-free artifact key for a module — `null` for the
 * root module, whose artifacts stay FLAT under the per-repo dir (0018/D2's
 * layout, unchanged for every single-project repo).
 */
export function moduleSlug(module) {
  const dir = module?.dir ?? ".";
  return dir === "." ? null : normalizePath(dir).replace(/\//g, "__");
}

/**
 * Every `primary-manifest` path the fingerprint recorded for the ecosystem ids
 * covered by this step-9 lane group — deduped and sorted, so the module list is
 * a pure function of the fingerprint and never of object-key iteration order.
 */
function primaryManifests(fp, group) {
  const ids = ECOSYSTEM_GROUPS[group] ?? [];
  if (ids.length === 0) return [];
  const ecosystems = Array.isArray(fp?.ecosystems) ? fp.ecosystems : [];
  const paths = [];
  for (const eco of ecosystems) {
    if (!ids.includes(eco?.id)) continue;
    for (const signal of Array.isArray(eco?.signals) ? eco.signals : []) {
      if (signal?.kind !== "primary-manifest" || typeof signal.path !== "string") continue;
      paths.push(normalizePath(signal.path));
    }
  }
  return [...new Set(paths)].sort();
}

/**
 * Derive the project modules of a fingerprinted repo for one step-9 lane group.
 * @param {object} fp   the repo's detection report (`entry.fingerprint`)
 * @param {string} group  java | python | node | docker | golang | other
 * @returns {{dir: string, manifest: string|null}[]}  always non-empty
 */
export function repoModules(fp, group) {
  const manifests = primaryManifests(fp, group);

  // Rule 3 — nothing to go on (stub fingerprint, docker/other lane, no manifests).
  if (manifests.length === 0) return [{ ...ROOT_MODULE }];

  return modulesFromManifests(manifests);
}

/**
 * Rules 1–2 over an already-collected manifest list (the shared core of
 * `repoModules` and `installLocations`). Returns [] on an empty list — the
 * rule-3 floor is the CALLER'S decision: step-11 extraction can still run at
 * the clone root with no manifest, an install cannot (0026/D3 item 4).
 */
function modulesFromManifests(manifests) {
  // Rule 1 — a root manifest: the build tool owns any internal fan-out.
  const root = manifests.find((path) => dirOf(path) === ".");
  if (root) return [{ dir: ".", manifest: root }];

  // Rule 2 — top-most nested dirs only: a manifest under an ancestor that also
  // holds one is that ancestor build's business, not a module of its own.
  const dirs = [...new Set(manifests.map(dirOf))].sort();
  const topMost = dirs.filter((dir) => !dirs.some((other) => other !== dir && dir.startsWith(`${other}/`)));
  return topMost.map((dir) => ({ dir, manifest: manifests.find((path) => dirOf(path) === dir) }));
}

/**
 * Derive every INSTALL LOCATION a fingerprint records, across ALL ecosystems —
 * `{dir, manifest, ecosystem}` entries, ecosystem-tagged with the step-11 lane
 * GROUP so a consumer can select a playbook without re-sniffing manifest
 * basenames (change record 0026/D3; the `integrated[].modules` producer per
 * 0026/A2). Pure and deterministic — no fs, no subprocess, no model.
 *
 * 1. For each ecosystem id the fingerprint records that maps to a non-empty
 *    `ECOSYSTEM_GROUPS` group, apply rules 1–2 to THAT id's `primary-manifest`
 *    paths and tag each module with the group. Rule 1 still carries the load:
 *    an npm-workspaces / pom-aggregator / settings.gradle root installs ONCE —
 *    the build tool owns its internal fan-out.
 * 2. Union with `fp.subRepos[]` (`{path, dominantEcosystem, primaryManifests}`,
 *    populated by the `--deep` shadow scan and previously read by NOTHING) —
 *    how a `topology.type: "monorepo"` with no root manifest yields its
 *    independent sub-projects.
 * 3. Dedup on `(dir, ecosystem)` and sort — a pure function of the
 *    fingerprint, never of object-key iteration order.
 * 4. Empty fingerprint (a `--mock` stub, docker/other) → `[]`, NOT the
 *    `ROOT_MODULE` floor: an install with no known ecosystem has nothing to
 *    run and must record `skipped: "no-playbook"` rather than guess a command.
 */
export function installLocations(fp) {
  const candidates = [];

  // 1 — per ecosystem id, rules 1–2 over that id's own manifests.
  const ecosystems = Array.isArray(fp?.ecosystems) ? fp.ecosystems : [];
  const ids = [...new Set(ecosystems.map((eco) => eco?.id).filter((id) => typeof id === "string"))].sort();
  for (const id of ids) {
    const group = ecosystemGroup(id);
    if (!group) continue; // docker/other cover no language ids — no install lane
    const paths = [];
    for (const eco of ecosystems) {
      if (eco?.id !== id) continue;
      for (const signal of Array.isArray(eco?.signals) ? eco.signals : []) {
        if (signal?.kind !== "primary-manifest" || typeof signal.path !== "string") continue;
        paths.push(normalizePath(signal.path));
      }
    }
    const manifests = [...new Set(paths)].sort();
    for (const module of modulesFromManifests(manifests)) {
      candidates.push({ ...module, ecosystem: group });
    }
  }

  // 2 — union with the shadow-scanned sub-repos (monorepo with no root manifest).
  for (const sub of Array.isArray(fp?.subRepos) ? fp.subRepos : []) {
    const group = ecosystemGroup(sub?.dominantEcosystem);
    if (!group) continue;
    if (typeof sub?.path !== "string" || sub.path.length === 0) continue;
    const first = Array.isArray(sub.primaryManifests) ? sub.primaryManifests.find((p) => typeof p === "string") : null;
    candidates.push({ dir: normalizePath(sub.path), manifest: first ? normalizePath(first) : null, ecosystem: group });
  }

  // 3 — dedup on (dir, ecosystem), deterministic order. A manifest-carrying
  // entry wins its keyed slot over a manifest-less subRepos twin.
  candidates.sort(
    (a, b) =>
      a.dir.localeCompare(b.dir) ||
      a.ecosystem.localeCompare(b.ecosystem) ||
      String(a.manifest ?? "￿").localeCompare(String(b.manifest ?? "￿")),
  );
  const byKey = new Map();
  for (const loc of candidates) {
    const key = `${loc.dir}\u0000${loc.ecosystem}`;
    if (!byKey.has(key)) byKey.set(key, loc);
  }
  return [...byKey.values()];
}
