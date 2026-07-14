#!/usr/bin/env node
// Hoist every sub-package's dependencies/devDependencies into the ROOT package.json so the
// root manifest is a superset of the workspace. Additive by design: existing root entries are
// never overwritten or removed — the script only fills in what the root is missing.
//
// Skipped by default:
//   - node_modules/ and .harness/ trees
//   - fixture trees (`fixtures/`) — those are deliberately-stale/vulnerable test data
//     (override with --include-fixtures)
//   - workspace-internal packages (any name declared by a scanned package.json), which are
//     resolved via the `workspaces` field, not the registry
//
// Usage:
//   node scripts/merge-package-deps.mjs              # merge + write root package.json
//   node scripts/merge-package-deps.mjs --dry-run    # print what would change, write nothing
//   node scripts/merge-package-deps.mjs --check      # exit 1 if root is missing any dep (CI gate)
//   node scripts/merge-package-deps.mjs --include-fixtures
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rootManifestPath = join(root, 'package.json');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const check = argv.includes('--check');
const includeFixtures = argv.includes('--include-fixtures');

const SKIP_DIRS = new Set(['node_modules', '.harness', '.git', 'dist', 'build', 'coverage']);

/** Recursively collect package.json paths, minus ignored trees. */
function collectManifests(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_DIRS.has(entry)) continue;
    if (!includeFixtures && entry === 'fixtures') continue;
    if (statSync(full).isDirectory()) {
      collectManifests(full, acc);
    } else if (entry === 'package.json') {
      acc.push(full);
    }
  }
  return acc;
}

/** Compare two version specs by their numeric core; range prefixes (^ ~ >=) are ignored. */
function compareSpecs(a, b) {
  const core = (s) => (String(s).match(/\d+(?:\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
  const [x, y] = [core(a), core(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
const manifestPaths = collectManifests(root).filter((p) => p !== rootManifestPath);

// Names declared anywhere in the workspace are internal — never hoist them as registry deps.
const internalNames = new Set([rootManifest.name]);
const manifests = manifestPaths.map((path) => {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  if (json.name) internalNames.add(json.name);
  return { path, json };
});

// Collect every requested spec per package, per section. A package requested as a runtime
// dependency anywhere is hoisted as a runtime dependency (the stronger of the two sections).
/** @type {Map<string, {section: string, specs: Map<string, string[]>}>} */
const wanted = new Map();
for (const { path, json } of manifests) {
  const from = relative(root, path);
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(json[section] ?? {})) {
      if (internalNames.has(name)) continue;
      const entry = wanted.get(name) ?? { section, specs: new Map() };
      if (section === 'dependencies') entry.section = 'dependencies';
      entry.specs.set(spec, [...(entry.specs.get(spec) ?? []), from]);
      wanted.set(name, entry);
    }
  }
}

const rootDeps = rootManifest.dependencies ?? {};
const rootDevDeps = rootManifest.devDependencies ?? {};
const additions = { dependencies: {}, devDependencies: {} };
const conflicts = [];

for (const [name, { section, specs }] of [...wanted].sort(([a], [b]) => a.localeCompare(b))) {
  const specList = [...specs.keys()];
  // Multiple sub-packages disagreeing on a version: hoist the highest, report the rest.
  const winner = specList.sort(compareSpecs).at(-1);
  if (specList.length > 1) {
    conflicts.push({ name, winner, specs: [...specs].map(([s, f]) => `${s} (${f.join(', ')})`) });
  }

  const existing = rootDeps[name] ?? rootDevDeps[name];
  if (existing !== undefined) {
    // Root already pins it: additive merge means the root's own pin stands.
    if (compareSpecs(existing, winner) !== 0) {
      conflicts.push({ name, winner: `root keeps ${existing}`, specs: [`sub-packages want ${winner}`] });
    }
    continue;
  }
  additions[section][name] = winner;
}

const added = [...Object.entries(additions.dependencies), ...Object.entries(additions.devDependencies)];

for (const { name, winner, specs } of conflicts) {
  console.warn(`warn  ${name}: ${specs.join(' | ')} -> ${winner}`);
}

if (added.length === 0) {
  console.log(`ok    root package.json already covers all ${wanted.size} sub-package deps`);
  process.exit(0);
}

for (const [section, entries] of Object.entries(additions)) {
  for (const [name, spec] of Object.entries(entries)) {
    console.log(`add   ${section}: ${name}@${spec}`);
  }
}

if (check) {
  console.error(`fail  root package.json is missing ${added.length} sub-package dep(s)`);
  process.exit(1);
}

if (dryRun) {
  console.log(`dry   ${added.length} dep(s) would be added to ${relative(root, rootManifestPath) || 'package.json'}`);
  process.exit(0);
}

// Merge additions in, keeping each section alphabetically sorted (npm's own convention).
const sorted = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

if (Object.keys(additions.dependencies).length > 0) {
  rootManifest.dependencies = sorted({ ...rootDeps, ...additions.dependencies });
}
if (Object.keys(additions.devDependencies).length > 0) {
  rootManifest.devDependencies = sorted({ ...rootDevDeps, ...additions.devDependencies });
}

writeFileSync(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`);
console.log(
  `ok    added ${added.length} dep(s) from ${manifests.length} sub-package(s) to package.json`,
);
