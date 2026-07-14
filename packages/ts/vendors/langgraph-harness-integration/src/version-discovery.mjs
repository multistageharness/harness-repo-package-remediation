/**
 * src/version-discovery.mjs — the shared install-test VERSION-DISCOVERY engine
 * (change record 0033/D0): "find the next available version" for one package
 * under one package manager, generalized from the
 * PLAYGROUND_FIND_DEPENDENCY_VERSIONS `cli.mjs → NpmVersionsSDK → main.mjs`
 * pattern behind a per-package-manager ADAPTER table (0033/D1–D9).
 *
 * Three verbs, all thin over `probeCandidates`:
 *   - `versions(pm, pkg)` — list what the datasource advertises, as `Release[]`
 *     records with mandatory provenance (`{version, releaseTimestamp,
 *     isDeprecated}` — record 0019/D2's discipline, reusing `getReleases` for
 *     npm and per-adapter datasources for the rest).
 *   - `find(pm, pkg)` — rank candidates above `current` by the ecosystem's
 *     version grammar, install-test each in an isolated scratch dir, and STOP
 *     at the first that installs → `{found, version, tested[]}`.
 *   - `test(pm, pkg)` — install-test every ranked candidate (or the newest
 *     `limit`) and report `{installable[], failed[], results[]}` (optionally
 *     written as a JSON report — the playground's `installation_report.json`).
 *
 * ADAPTER CONTRACT (the 0033 growth seam — one adapter + one `.tool.json` per
 * package manager, never an engine edit): `{ packageManager, ecosystem,
 * datasource, grammar, listVersions, installArgv, scaffoldFiles? }`.
 * `grammar` supplies `isVersion/isStable/isGreater/compare` — semver for
 * npm/pnpm/cargo via versioning-npm; tolerant dotted for pip/poetry/uv/conda
 * (PEP 440 stability) and maven (variant-classifier stability) via
 * versioning-ext; the variant-aware tag grammar for docker via
 * versioning-docker (0037/A2, A3). `installArgv` returns the literal argv list
 * matching the manifest's `argv_template`; `scaffoldFiles` names the minimal
 * manifest files the install-test needs in the scratch dir.
 *
 * MOCK / SECURITY CONTRACT: under `ctx.options.mock` every verb short-circuits
 * to a deterministic synthetic result derived from the package name (mirrors
 * `mockReleases`) — zero HTTP, zero subprocess, zero scratch dir. The one
 * synthetic rule: the `99.0.0` advertised ceiling FAILS its mock install-test,
 * so `find` provably exercises the "newest is broken, fall back" path offline.
 * Every real install-test is an argv-list subprocess (security rule §4) run in
 * a `mkdtemp` scratch dir that is removed in `finally`, bounded by `timeoutMs`;
 * registry credentials come from env at the seam (rule §5) — pip, for one,
 * honors `PIP_INDEX_URL` itself (the local-devpi convention: fail fast when the
 * index is down, never reroute). Real fetches follow registry-lookup's shape:
 * injectable `fetchImpl`, 404 → "package unknown" (empty list, not an error),
 * 429/5xx → throw `retryable: true`, other non-OK → fatal throw.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runArgv, writeFileAtomic } from "./sdk.mjs";
import { getReleases, mockReleases } from "./registry-lookup.mjs";
import { isVersion, isStable, isGreaterThan, sortVersions } from "./versioning-npm.mjs";
import { isDottedVersion, isGreaterDotted, compareDotted, isStableMaven, isStablePep440 } from "./versioning-ext.mjs";
import { DOCKER_GRAMMAR } from "./versioning-docker.mjs";

/** Default per-candidate install-test budget (bounded execution, rule 4). */
const DEFAULT_TIMEOUT_MS = 120_000;

/** The one synthetic mock rule: the advertised `99.0.0` ceiling never installs. */
const MOCK_UNINSTALLABLE = "99.0.0";

// ── version grammars ────────────────────────────────────────────────────────

/** Strict semver (npm / pnpm / cargo) — versioning-npm verbatim. */
const SEMVER_GRAMMAR = { isVersion, isStable, isGreater: isGreaterThan, compare: sortVersions };

/**
 * Tolerant dotted-numeric — one comparator, TWO stability rules (0037/A2). An
 * alphabetic tail is not evidence of a prerelease: `31.1-jre` is Guava's only
 * release coordinate, and the old `qualifier === ""` rule filtered every Guava
 * release out of the candidate set, reporting "no upgrade" for the whole maven
 * ecosystem. Unknown tails are stable for maven (a variant classifier) and
 * unstable for PEP 440 (which enumerates its prerelease spellings).
 */
const PEP440_GRAMMAR = { isVersion: isDottedVersion, isStable: isStablePep440, isGreater: isGreaterDotted, compare: compareDotted };
const MAVEN_GRAMMAR = { isVersion: isDottedVersion, isStable: isStableMaven, isGreater: isGreaterDotted, compare: compareDotted };

// ── datasource fetch helpers (registry-lookup's conventions) ────────────────

async function fetchBody(url, fetchImpl, asJson) {
  const res = await fetchImpl(url);
  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    throw Object.assign(new Error(`version-discovery: ${res.status} for ${url}`), { retryable: true });
  }
  if (!res.ok) throw new Error(`version-discovery: ${res.status} for ${url}`);
  return asJson ? res.json() : res.text();
}

/** npm registry (registry.npmjs.org) — reuses getReleases, the one pre-0033 real path. */
async function npmListVersions(pkg, opts, ctx, fetchImpl) {
  const found = await getReleases({ packageName: pkg, registryUrl: opts.registryUrl }, ctx, fetchImpl);
  return found?.releases ?? [];
}

/** PyPI JSON API (pypi.org/pypi/{pkg}/json) — pip/poetry/uv share this datasource. */
async function pypiListVersions(pkg, opts, _ctx, fetchImpl) {
  const base = opts.registryUrl ?? "https://pypi.org";
  const doc = await fetchBody(`${base}/pypi/${encodeURIComponent(String(pkg))}/json`, fetchImpl, true);
  if (doc === null) return [];
  return Object.entries(doc.releases ?? {}).map(([version, files]) => ({
    version,
    releaseTimestamp: (Array.isArray(files) && files[0]?.upload_time_iso_8601) || null,
    isDeprecated: Array.isArray(files) && files.length > 0 && files.every((f) => f?.yanked === true),
  }));
}

/** anaconda.org channel API — conda packages are NOT PyPI packages (0033/D6). */
async function condaListVersions(pkg, opts, _ctx, fetchImpl) {
  const base = opts.registryUrl ?? "https://api.anaconda.org";
  const channel = opts.channel ?? "conda-forge";
  const doc = await fetchBody(`${base}/package/${encodeURIComponent(channel)}/${encodeURIComponent(String(pkg))}`, fetchImpl, true);
  if (doc === null) return [];
  return (Array.isArray(doc.versions) ? doc.versions : [])
    .filter((v) => typeof v === "string" && v.length > 0)
    .map((version) => ({ version, releaseTimestamp: null, isDeprecated: false }));
}

/** Maven Central maven-metadata.xml — `pkg` is `group:artifact` (0033/D7). */
async function mavenListVersions(pkg, opts, _ctx, fetchImpl) {
  const [group, artifact] = String(pkg).split(":");
  if (!group || !artifact) throw new Error(`version-discovery: maven package must be 'group:artifact', got '${pkg}'`);
  const base = opts.registryUrl ?? "https://repo1.maven.org/maven2";
  const xml = await fetchBody(`${base}/${group.replace(/\./g, "/")}/${encodeURIComponent(artifact)}/maven-metadata.xml`, fetchImpl, false);
  if (xml === null) return [];
  const releases = [];
  for (const m of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
    releases.push({ version: m[1].trim(), releaseTimestamp: null, isDeprecated: false });
  }
  return releases;
}

/** crates.io API — versions carry `num`/`created_at`/`yanked` (0033/D8). */
async function cargoListVersions(pkg, opts, _ctx, fetchImpl) {
  const base = opts.registryUrl ?? "https://crates.io";
  const doc = await fetchBody(`${base}/api/v1/crates/${encodeURIComponent(String(pkg))}`, fetchImpl, true);
  if (doc === null) return [];
  return (Array.isArray(doc.versions) ? doc.versions : [])
    .filter((v) => typeof v?.num === "string")
    .map((v) => ({ version: v.num, releaseTimestamp: v.created_at ?? null, isDeprecated: v.yanked === true }));
}

/** Registry v2 tags list — `/v2/{repo}/tags/list` (0033/D9); tags, not versions. */
async function dockerListTags(pkg, opts, _ctx, fetchImpl) {
  const base = opts.registryUrl ?? "https://registry-1.docker.io";
  const doc = await fetchBody(`${base}/v2/${String(pkg)}/tags/list`, fetchImpl, true);
  if (doc === null) return [];
  return (Array.isArray(doc.tags) ? doc.tags : [])
    .filter((t) => typeof t === "string" && t.length > 0)
    .map((tag) => ({ version: tag, releaseTimestamp: null, isDeprecated: false }));
}

// ── scratch-dir scaffolds ───────────────────────────────────────────────────

const NODE_SCRATCH_MANIFEST = `${JSON.stringify({ name: "version-discovery-scratch", version: "0.0.0", private: true }, null, 2)}\n`;

const POETRY_SCRATCH_MANIFEST = [
  "[tool.poetry]",
  'name = "version-discovery-scratch"',
  'version = "0.0.0"',
  'description = ""',
  'authors = ["version-discovery scratch"]',
  "",
  "[tool.poetry.dependencies]",
  'python = ">=3.9"',
  "",
].join("\n");

const CARGO_SCRATCH_MANIFEST = [
  "[package]",
  'name = "version-discovery-scratch"',
  'version = "0.0.0"',
  'edition = "2021"',
  "",
].join("\n");

// ── the adapter table (0033/D1–D9) ──────────────────────────────────────────
//
// Every `installArgv` matches its manifest's `argv_template` token-for-token
// (harness-repo-package-remediation/tools/<group>/<pm>-find-next-version.tool.json) — literal argv
// lists, no shell metacharacters, structurally un-shell-able (rule §4).

export const VERSION_DISCOVERY_ADAPTERS = {
  npm: {
    packageManager: "npm",
    ecosystem: "node",
    datasource: "npm-registry",
    grammar: SEMVER_GRAMMAR,
    listVersions: npmListVersions,
    scaffoldFiles: () => ({ "package.json": NODE_SCRATCH_MANIFEST }),
    installArgv: (pkg, version) => ["npm", "install", `${pkg}@${version}`, "--no-save", "--no-audit", "--no-fund"],
  },
  pnpm: {
    packageManager: "pnpm",
    ecosystem: "node",
    datasource: "npm-registry",
    grammar: SEMVER_GRAMMAR,
    listVersions: npmListVersions, // same registry + grammar as npm; only the install-test binary differs (0033/D2)
    scaffoldFiles: () => ({ "package.json": NODE_SCRATCH_MANIFEST }),
    installArgv: (pkg, version) => ["pnpm", "add", `${pkg}@${version}`, "--save-dev=false", "--lockfile-only"],
  },
  pip: {
    packageManager: "pip",
    ecosystem: "python",
    datasource: "pypi",
    grammar: PEP440_GRAMMAR,
    listVersions: pypiListVersions,
    scaffoldFiles: null,
    installArgv: (pkg, version) => ["pip", "install", `${pkg}==${version}`, "--dry-run"],
  },
  poetry: {
    packageManager: "poetry",
    ecosystem: "python",
    datasource: "pypi",
    grammar: PEP440_GRAMMAR,
    listVersions: pypiListVersions, // reuses D3's PyPI adapter; poetry's solver surfaces conflicts pip's --dry-run misses (0033/D4)
    scaffoldFiles: () => ({ "pyproject.toml": POETRY_SCRATCH_MANIFEST }),
    installArgv: (pkg, version) => ["poetry", "add", `${pkg}@${version}`, "--dry-run"],
  },
  uv: {
    packageManager: "uv",
    ecosystem: "python",
    datasource: "pypi",
    grammar: PEP440_GRAMMAR,
    listVersions: pypiListVersions, // same registry, much faster resolver — cheap test-all reports (0033/D5)
    scaffoldFiles: null,
    installArgv: (pkg, version) => ["uv", "pip", "install", `${pkg}==${version}`, "--dry-run"],
  },
  conda: {
    packageManager: "conda",
    ecosystem: "python",
    datasource: "anaconda-org",
    grammar: PEP440_GRAMMAR,
    listVersions: condaListVersions,
    scaffoldFiles: null,
    // --dry-run --json: parse the solve result, no real env mutation (0033/D6)
    installArgv: (pkg, version) => ["conda", "install", "--dry-run", "--json", `${pkg}=${version}`],
  },
  maven: {
    packageManager: "maven",
    ecosystem: "java",
    datasource: "maven-central",
    grammar: MAVEN_GRAMMAR,
    listVersions: mavenListVersions,
    scaffoldFiles: null,
    // dependency:get resolves from the repo without a full build (0033/D7)
    installArgv: (pkg, version) => ["mvn", "-B", "dependency:get", `-Dartifact=${pkg}:${version}`],
  },
  cargo: {
    packageManager: "cargo",
    ecosystem: "rust", // hard-requires 0033/A1's rust group
    datasource: "crates-io",
    grammar: SEMVER_GRAMMAR,
    listVersions: cargoListVersions,
    scaffoldFiles: () => ({ "Cargo.toml": CARGO_SCRATCH_MANIFEST, "src/lib.rs": "" }),
    installArgv: (pkg, version) => ["cargo", "add", `${pkg}@${version}`, "--dry-run"],
  },
  docker: {
    packageManager: "docker",
    ecosystem: "docker",
    datasource: "registry-v2-tags",
    grammar: DOCKER_GRAMMAR,
    listVersions: dockerListTags,
    scaffoldFiles: null,
    // "install-test" = a pull-free existence/arch probe, never a docker pull (0033/D9)
    installArgv: (pkg, version) => ["docker", "manifest", "inspect", `${pkg}:${version}`],
  },
};

/** The adapter for a package manager, or null — a checked lookup, never a throw. */
export function getAdapter(packageManager) {
  return (typeof packageManager === "string" && Object.hasOwn(VERSION_DISCOVERY_ADAPTERS, packageManager) && VERSION_DISCOVERY_ADAPTERS[packageManager]) || null;
}

/**
 * Late-register (or override) an adapter — the growth seam: a new package
 * manager is one adapter + one `.tool.json`, never an engine edit.
 */
export function registerAdapter(packageManager, adapter) {
  if (typeof packageManager !== "string" || packageManager.length === 0) {
    throw new Error("version-discovery: registerAdapter needs a package-manager id");
  }
  VERSION_DISCOVERY_ADAPTERS[packageManager] = { packageManager, ...adapter };
  return VERSION_DISCOVERY_ADAPTERS[packageManager];
}

function requireAdapter(packageManager) {
  const adapter = getAdapter(packageManager);
  if (adapter === null) {
    throw new Error(`version-discovery: unknown package manager '${packageManager}' (known: ${Object.keys(VERSION_DISCOVERY_ADAPTERS).join(" | ")})`);
  }
  return adapter;
}

function requirePackage(pkg) {
  if (typeof pkg !== "string" || pkg.length === 0) throw new Error("version-discovery: 'pkg' must be a non-empty string");
  return pkg;
}

// ── ranking ─────────────────────────────────────────────────────────────────

/**
 * Filter + sort the advertised releases to install-test candidates: parseable
 * by the adapter's grammar, stable, not deprecated, and strictly greater than
 * `current` when `current` is itself parseable (an unparseable/absent current
 * admits everything — mirroring the target ladder's range handling).
 * `order: "desc"` (default) is the playground's newest-first; `"asc"` is the
 * ladder's minimal-bump-first. `limit` caps AFTER ordering ("newest N").
 */
export function rankCandidates(adapter, releases, current = null, { order = "desc", limit = null } = {}) {
  const g = adapter.grammar;
  const currentComparable = typeof current === "string" && g.isVersion(current);
  const eligible = (Array.isArray(releases) ? releases : []).filter(
    (r) =>
      r !== null &&
      typeof r?.version === "string" &&
      g.isVersion(r.version) &&
      g.isStable(r.version) &&
      r.isDeprecated !== true &&
      (!currentComparable || g.isGreater(r.version, current)),
  );
  eligible.sort((a, b) => g.compare(a.version, b.version));
  if (order === "desc") eligible.reverse();
  return limit != null ? eligible.slice(0, limit) : eligible;
}

// ── the probe core (shared by find/test) ────────────────────────────────────

function normalizeCandidates(candidates) {
  return candidates
    .map((c) => (typeof c === "string" ? { version: c, releaseTimestamp: null, isDeprecated: false } : c))
    .filter((c) => c && typeof c.version === "string" && c.version.length > 0);
}

function truncate(text, max = 400) {
  const s = String(text ?? "").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Rank (or accept pre-ranked `opts.candidates`, tested IN THE ORDER GIVEN —
 * the 0033/A2 ladder seam) and install-test candidates. `firstOnly` stops at
 * the first success. Mock: synthetic verdicts, no subprocess, no scratch dir.
 */
async function probeCandidates(packageManager, pkg, opts, ctx) {
  const adapter = requireAdapter(packageManager);
  requirePackage(pkg);
  const mock = ctx?.options?.mock === true;

  let candidates;
  if (Array.isArray(opts.candidates)) {
    candidates = normalizeCandidates(opts.candidates);
  } else {
    const releases = mock ? mockReleases(pkg) : await adapter.listVersions(pkg, opts, ctx, opts.fetchImpl ?? globalThis.fetch);
    candidates = rankCandidates(adapter, releases, opts.current ?? null, { order: opts.order ?? "desc", limit: opts.limit ?? null });
  }

  if (mock) {
    const tested = [];
    for (const c of candidates) {
      const ok = c.version !== MOCK_UNINSTALLABLE;
      tested.push({
        version: c.version,
        releaseTimestamp: c.releaseTimestamp ?? null,
        ok,
        exitCode: ok ? 0 : 1,
        detail: ok ? null : "mock install-test failed (synthetic 99.0.0 ceiling)",
      });
      if (opts.firstOnly && ok) break;
    }
    return { mocked: true, tested };
  }

  const runner = opts.runner ?? runArgv;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tested = [];
  const scratch = await mkdtemp(join(tmpdir(), `version-discovery-${packageManager}-`));
  try {
    const files = typeof adapter.scaffoldFiles === "function" ? adapter.scaffoldFiles(pkg) : null;
    for (const [rel, content] of Object.entries(files ?? {})) {
      const path = join(scratch, rel);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    for (const c of candidates) {
      const argv = adapter.installArgv(pkg, c.version);
      // allowNonZero: a failing candidate is DATA (`ok: false`), never a throw;
      // a spawn-level error (binary missing) degrades to exit 127, same shape.
      const res = await runner(argv, { cwd: scratch, timeoutMs, allowNonZero: true }).catch((err) => ({
        stdout: "",
        stderr: err?.message ?? String(err),
        exitCode: typeof err?.exitCode === "number" ? err.exitCode : 127,
      }));
      const ok = res.exitCode === 0;
      tested.push({
        version: c.version,
        releaseTimestamp: c.releaseTimestamp ?? null,
        ok,
        exitCode: res.exitCode,
        detail: ok ? null : truncate(res.stderr || res.stdout),
      });
      if (opts.firstOnly && ok) break;
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return { mocked: false, tested };
}

// ── the three verbs ─────────────────────────────────────────────────────────

/**
 * List what the datasource advertises for `pkg` — `Release[]`, provenance
 * mandatory. Mock: the deterministic `mockReleases` synthesis, zero HTTP.
 */
export async function versions(packageManager, pkg, opts = {}, ctx = {}) {
  const adapter = requireAdapter(packageManager);
  requirePackage(pkg);
  const mock = ctx?.options?.mock === true;
  const releases = mock ? mockReleases(pkg) : await adapter.listVersions(pkg, opts, ctx, opts.fetchImpl ?? globalThis.fetch);
  return { packageManager, package: pkg, datasource: adapter.datasource, mocked: mock, count: releases.length, releases };
}

/**
 * Install-test the ranked candidates and stop at the FIRST that installs —
 * the playground's `find`, the smarter rung-③ the 0033/A2 seam delegates to.
 * Honors `opts.candidates` (pre-ranked, tested in order), `opts.current`,
 * `opts.order` (`"desc"` newest-first default, `"asc"` minimal-bump-first),
 * `opts.limit`, `opts.timeoutMs`, `opts.runner`/`opts.fetchImpl` (test seams).
 */
export async function find(packageManager, pkg, opts = {}, ctx = {}) {
  const probe = await probeCandidates(packageManager, pkg, { ...opts, firstOnly: true }, ctx);
  const hit = probe.tested.find((t) => t.ok) ?? null;
  return {
    packageManager,
    package: pkg,
    current: opts.current ?? null,
    mocked: probe.mocked,
    found: hit !== null,
    version: hit?.version ?? null,
    releaseTimestamp: hit?.releaseTimestamp ?? null,
    tested: probe.tested,
  };
}

/**
 * Install-test EVERY ranked candidate (or the newest `opts.limit`) and report
 * `{installable[], failed[], results[]}` — the playground's `test`. When
 * `opts.reportPath` is set the report is also written as JSON (atomic write).
 */
export async function test(packageManager, pkg, opts = {}, ctx = {}) {
  const probe = await probeCandidates(packageManager, pkg, { ...opts, firstOnly: false }, ctx);
  const report = {
    packageManager,
    package: pkg,
    current: opts.current ?? null,
    mocked: probe.mocked,
    count: probe.tested.length,
    installable: probe.tested.filter((t) => t.ok).map((t) => t.version),
    failed: probe.tested.filter((t) => !t.ok).map((t) => t.version),
    results: probe.tested,
  };
  if (typeof opts.reportPath === "string" && opts.reportPath.length > 0) {
    await writeFileAtomic(opts.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    report.reportPath = opts.reportPath;
  }
  return report;
}
