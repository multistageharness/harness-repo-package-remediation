/**
 * src/ecosystem-registry.mjs — the single source of per-ecosystem knowledge
 * for the integration pack (record 0019/A4, widened from the related plan's
 * feature 04/02; Renovate's manager-module contract is the template: one
 * registry entry per ecosystem id, consumers look up instead of maintaining
 * private tables).
 *
 * Consolidates what were three independently-drifting tables:
 *   - the per-ecosystem command defaults (data moved from the vendored
 *     setup-report table; `fingerprint-lib`/`detect-setup` delegate here),
 *   - `depgraph-extract.mjs`'s toolchain sub-detect (`detectToolchain`),
 *   - record 0018's per-ecosystem depgraph command matrix (`depgraphCommands`).
 *
 * Per-id entries carry `{ id, defaultCommands, datasource, extract, bump }` —
 * explicit nulls so "unsupported" is a checked lookup, not an undefined
 * surprise. Glob/signal lists are NOT duplicated here: the pristine mirror's
 * signal-matrix stays the presence-detection source of truth; this registry
 * references ecosystem ids only.
 */

import { join } from "node:path";

import { extractNpmDependencies, extractGoModDependencies, extractMavenDependencies, extractPipRequirements } from "./manifest-deps.mjs";
import { addNpmOverride, bumpNpmDependency } from "./manifest-edit.mjs";
import { bumpMavenDependency, bumpPythonDependency, pinMavenDependencyManagement, pinPipConstraint } from "./manifest-edit-ext.mjs";

/**
 * Registry keyed by signal-matrix ecosystem ids. node carries the remediate
 * stage's bump helper (Epic 03 / 0019 D2); every other id is an explicit
 * `bump: null` — the remediate atom records "no bump support" instead of
 * silently ignoring those records. `registerBump` remains for future
 * ecosystems that land their bump helper after the registry (0019/A4
 * "registry grows incrementally").
 */
export const ECOSYSTEMS = {
  node: {
    id: "node",
    defaultCommands: { setup: [], install: ["npm ci"], run: ["npm start"], test: ["npm test"] },
    datasource: "npm",
    extract: extractNpmDependencies,
    bump: bumpNpmDependency,
  },
  "java-maven": {
    id: "java-maven",
    defaultCommands: { setup: [], install: ["mvn -B install -DskipTests"], run: [], test: ["mvn -B test"] },
    datasource: "maven",
    // 0032/D3+D4: pom.xml reader + <version> token bump (direct <dependency>
    // entries only; property-valued versions record a skip, never a guess).
    extract: extractMavenDependencies,
    bump: bumpMavenDependency,
  },
  "java-gradle": {
    id: "java-gradle",
    defaultCommands: { setup: [], install: ["./gradlew build -x test"], run: [], test: ["./gradlew test"] },
    datasource: "maven",
    extract: null,
    bump: null,
  },
  python: {
    id: "python",
    defaultCommands: { setup: ["python -m venv .venv"], install: ["pip install -r requirements.txt"], run: [], test: ["pytest"] },
    datasource: "pypi",
    // 0032/D3+D4: requirements.txt reader + pinned-line bump.
    // 0065: pyproject.toml is now WRITTEN too — `bumpPythonDependency` dispatches
    // on the manifest basename, because one ecosystem legitimately owns two
    // manifest grammars. (Poetry's [tool.poetry.dependencies] table is a third,
    // still unhandled — it returns null → an honest "manifest edit failed".)
    extract: extractPipRequirements,
    bump: bumpPythonDependency,
  },
  go: {
    id: "go",
    defaultCommands: { setup: [], install: ["go mod download"], run: ["go run ."], test: ["go test ./..."] },
    datasource: "go",
    extract: extractGoModDependencies,
    bump: null,
  },
  rust: {
    id: "rust",
    defaultCommands: { setup: [], install: ["cargo build"], run: ["cargo run"], test: ["cargo test"] },
    datasource: "crate",
    extract: null,
    bump: null,
  },
  ruby: {
    id: "ruby",
    defaultCommands: { setup: [], install: ["bundle install"], run: [], test: ["bundle exec rake test"] },
    datasource: "rubygems",
    extract: null,
    bump: null,
  },
};

/**
 * Entry for an ecosystem id, or null for unknown ids — graceful-degrade
 * echoing Renovate's unknown-id fallback (versioning/schema.ts), never an
 * exception in a lookup.
 */
export function getEcosystem(id) {
  return (typeof id === "string" && Object.hasOwn(ECOSYSTEMS, id) && ECOSYSTEMS[id]) || null;
}

/**
 * Step-9 lane GROUP → the signal-matrix ecosystem ids it covers (0025/D2).
 * Hoisted here from the two places it previously lived implicitly — the
 * router rules in `configs/flows/dependency-graph.yaml` and `detectToolchain`
 * below — so `repoModules` can ask "which of this fingerprint's ecosystems
 * belong to the lane that routed here?" without re-deriving the mapping.
 * docker/other cover no language ids: those lanes have no command matrix and
 * retain the placeholder stub (0018 A1 §4).
 */
export const ECOSYSTEM_GROUPS = {
  java: ["java-maven", "java-gradle"],
  python: ["python"],
  node: ["node", "typescript"],
  golang: ["go"],
  // 0033/A1: rust gets its own group so cargo tools validate without abusing
  // `other` (ECOSYSTEMS.rust already declares datasource "crate"). No install/
  // build/test playbook ships for rust yet — those stages record the honest
  // `skipped: "no-playbook"` rather than guessing a command.
  rust: ["rust"],
  docker: [],
  other: [],
};

/** Reverse lookup: signal-matrix ecosystem id → step-9 lane group, or null. */
export function ecosystemGroup(id) {
  if (typeof id !== "string") return null;
  for (const [group, ids] of Object.entries(ECOSYSTEM_GROUPS)) {
    if (ids.includes(id)) return group;
  }
  return null;
}

/**
 * Does this lane's command matrix consume a `module` (0025/A3)?
 *
 * Only `mvn` is pointed at an individual project manifest via `-f`. Every other
 * lane's tools resolve from the clone root and would emit N byte-identical
 * artifacts if fanned out, so the atom runs them ONCE against the root module —
 * preserving today's behavior and artifact layout exactly. Gradle is excluded
 * deliberately: `gradlew dependencies` has no per-manifest form, and a root
 * `settings.gradle` already fans out internally (0025/D2 rule 1).
 */
export function isModuleAware(ecosystem, toolchain) {
  return ecosystem === "java" && toolchain === "maven";
}

/** The generic `make` profile for an unresolvable/unknown ecosystem. */
export const GENERIC_DEFAULTS = { setup: ["make setup"], install: ["make install"], run: ["make run"], test: ["make test"] };

/**
 * The command-defaults profile for an ecosystem id (generic when
 * null/unknown), returning fresh arrays per call — the registry-backed
 * accessor `fingerprint-lib`/`detect-setup` delegate to (0019/A4; byte-equal
 * to the vendored table's behavior).
 */
export function defaultCommands(ecosystem) {
  const profile = getEcosystem(ecosystem)?.defaultCommands ?? GENERIC_DEFAULTS;
  return { setup: [...profile.setup], install: [...profile.install], run: [...profile.run], test: [...profile.test] };
}

/**
 * Transitive-pin writers (change record 0032/D2), keyed by ecosystem id —
 * the `strategy → writer` DATA the remediate atom dispatches on when a plan
 * action carries `strategy: transitive-pin` (0032/A2). A transitive fix
 * INTRODUCES an entry for a package that is not a declared dependency, so
 * each writer names the file it targets relative to the repo root:
 *   - node       → package.json `overrides` block   (npm-overrides-pin)
 *   - python     → constraints.txt pinned line      (pip-constraints-pin;
 *                  `createIfMissing` — pip consumes it via `-c constraints.txt`)
 *   - java-maven → pom.xml `<dependencyManagement>` (maven-dependency-pin)
 * `write(fileContent|null, depName, newValue) → edited text | null`.
 * Adding an ecosystem is one entry here + one writer module — never an atom
 * edit (platform growth rule 1).
 */
export const PIN_WRITERS = {
  node: { tool: "npm-overrides-pin", file: "package.json", createIfMissing: false, write: addNpmOverride },
  python: { tool: "pip-constraints-pin", file: "constraints.txt", createIfMissing: true, write: pinPipConstraint },
  "java-maven": { tool: "maven-dependency-pin", file: "pom.xml", createIfMissing: false, write: pinMavenDependencyManagement },
};

/** The transitive-pin writer for an ecosystem id, or null (→ recorded skip). */
export function getPinWriter(id) {
  return (typeof id === "string" && Object.hasOwn(PIN_WRITERS, id) && PIN_WRITERS[id]) || null;
}

/**
 * Late-register a bump helper on an existing entry (Epic 03 lands after the
 * registry exists — 0019/A4 "registry grows incrementally").
 */
export function registerBump(id, bump) {
  const entry = getEcosystem(id);
  if (!entry) throw new Error(`ecosystem-registry: cannot register bump for unknown ecosystem '${id}'`);
  entry.bump = bump;
  return entry;
}

/**
 * Resolve the exact toolchain within an ecosystem GROUP from the
 * fingerprint's presence signals (moved verbatim from depgraph-extract.mjs —
 * 0019/A4; the step-9 router branches at group level, this resolves the leaf
 * tool). Purely declarative over the already-computed fingerprint; returns
 * null when the signals are absent (e.g. a stub fingerprint under --mock).
 */
export function detectToolchain(ecosystem, fp) {
  const buildTools = Array.isArray(fp.buildTools) ? fp.buildTools : [];
  const pkgManagers = Array.isArray(fp.packageManagers) ? fp.packageManagers : [];
  const containers = Array.isArray(fp.infrastructure?.containers) ? fp.infrastructure.containers : [];
  const dominant = typeof fp.dominantEcosystem === "string" ? fp.dominantEcosystem : "";
  const has = (list, name) => list.includes(name);

  switch (ecosystem) {
    case "java":
      if (has(buildTools, "gradle") || has(pkgManagers, "gradle") || dominant.includes("gradle")) return "gradle";
      if (has(buildTools, "maven") || has(pkgManagers, "maven") || dominant.includes("maven")) return "maven";
      return null;
    case "python":
      if (has(pkgManagers, "poetry")) return "poetry";
      if (has(pkgManagers, "uv")) return "uv";
      if (has(pkgManagers, "pip")) return "pip";
      return null;
    case "node":
      if (dominant.includes("typescript") || has(buildTools, "tsc")) return "ts";
      return "mjs";
    case "docker":
      if (has(containers, "docker-compose")) return "docker-compose";
      if (has(containers, "docker")) return "docker";
      return null;
    case "golang":
      return "go";
    default:
      return null;
  }
}

/**
 * Record 0018's per-ecosystem depgraph command matrix, keyed by the step-9
 * lane group (+ resolved toolchain where it matters), as amended by 0025/A2+A3.
 * Each spec:
 *   { tool, argv, artifact, guard, parse?, produces?, allowNonZero? }
 * - argv: full argv list (security rule 4 — never an interpolated string)
 * - artifact: filename the raw stdout is saved to under the per-module save dir
 * - guard: the CLI (argv[0]) probed on PATH — absent → SKIP, never fail
 * - parse: "npm-list" | "go-mod-graph" | "pipdeptree" | "maven-tree" for the
 *   graph-yielding tools; listing/outdated/unused tools stay raw-artifact-only
 * - produces: an ABSOLUTE path the tool writes itself; when present the atom
 *   parses THAT file instead of stdout (0025/A2 — `mvn` emits its tree at INFO
 *   level, interleaved with `[INFO]` noise, unless `-DoutputFile` redirects it)
 *
 * `venvBin` (0018/D1) points python's deptry/pipdeptree at the provisioned
 * venv; `dir` scopes deptry to the repo clone. `module` (0025/A3) is the project
 * manifest this invocation targets — consumed only by the lanes
 * `isModuleAware` declares. `outDir` is the absolute per-module artifacts dir.
 * docker/other lanes have no matrix — they retain the placeholder stub
 * (0018 A1 §4).
 */
export function depgraphCommands(ecosystem, toolchain, { dir = ".", venvBin = null, module = null, outDir = ".", mavenAnalyze = false, pythonBin = null } = {}) {
  const venvTool = (bin) => (venvBin ? join(venvBin, bin) : bin);
  switch (ecosystem) {
    case "node":
      return [
        { tool: "npm-list", argv: ["npm", "list", "--json"], artifact: "npm-list.json", guard: "npm", allowNonZero: true, parse: "npm-list" },
        { tool: "npm-outdated", argv: ["npm", "outdated", "--json"], artifact: "npm-outdated.json", guard: "npm", allowNonZero: true },
        { tool: "knip", argv: ["npx", "--yes", "knip", "--no-exit-code"], artifact: "knip.txt", guard: "npx", allowNonZero: true },
        { tool: "dependency-tree", argv: ["npx", "--yes", "dependency-tree"], artifact: "dependency-tree.json", guard: "npx", allowNonZero: true, needsEntryFile: true },
      ];
    case "python":
      // 0026/A4: the tools resolve from the per-repo TOOLING venv
      // (`<clone>/.venv-deptry/bin`, via venvBin). deptry scans the clone —
      // `.venv` is excluded by deptry's defaults, but `.venv-deptry` is a
      // NON-DEFAULT name and needs the explicit `--extend-exclude` (the
      // record's checkable regression risk). pipdeptree enumerates ITS OWN
      // interpreter's env unless pointed elsewhere — `--python` targets the
      // step-10 install venv (`<clone>/.venv`), which is what makes its
      // output the repo's closure rather than the tooling pair.
      return [
        { tool: "pip-list", argv: ["pip", "list"], artifact: "pip-list.txt", guard: "pip", allowNonZero: true },
        { tool: "pip-outdated", argv: ["pip", "list", "--outdated"], artifact: "pip-outdated.txt", guard: "pip", allowNonZero: true },
        { tool: "pip-freeze", argv: ["pip", "freeze"], artifact: "requirements.txt", guard: "pip", allowNonZero: true },
        { tool: "deptry", argv: [venvTool("deptry"), dir, "--extend-exclude", "\\.venv-deptry"], artifact: "deptry.txt", guard: venvTool("deptry"), allowNonZero: true },
        {
          tool: "pipdeptree",
          argv: pythonBin ? [venvTool("pipdeptree"), "--python", pythonBin, "--json"] : [venvTool("pipdeptree"), "--json"],
          artifact: "pipdeptree.txt",
          guard: venvTool("pipdeptree"),
          allowNonZero: true,
          parse: "pipdeptree",
        },
      ];
    case "java": {
      if (toolchain === "gradle") {
        // prefer the repo-local wrapper, fall back to gradle on PATH (0018 A1 §6)
        return [{ tool: "gradle-dependencies", argv: [join(dir, "gradlew"), "dependencies"], artifact: "gradle-dependencies.txt", guard: join(dir, "gradlew"), fallbackArgv: ["gradle", "dependencies"], fallbackGuard: "gradle", allowNonZero: true }];
      }
      // 0025/A2: `dependency:tree`, not `dependency:analyze`. `analyze` triggers
      // `test-compile` and CREATES `target/` inside the clone — and `target/` is
      // a tracked directory in at least one real target repo, so the extractor
      // was dirtying the working tree the snapshot/remediate stages then diff.
      // `tree` resolves without compiling and leaves the clone byte-clean.
      //
      // `-f <manifest>` is resolved against `cwd` (the clone root); Maven accepts
      // a pom OR a directory. Every `-D…` is a SINGLE argv token — security
      // rule 4 holds (no interpolated command string, no shell).
      const target = module?.manifest ?? ".";
      const specs = [{
        tool: "mvn-dependency-tree",
        argv: ["mvn", "-B", "-f", target, "dependency:tree", "-DoutputType=json", `-DoutputFile=${join(outDir, "mvn-dependency-tree.json")}`],
        artifact: "mvn-dependency-tree.log", // stdout (Maven's own build log)
        produces: join(outDir, "mvn-dependency-tree.json"), // the tree the atom parses
        guard: "mvn",
        allowNonZero: true,
        parse: "maven-tree",
      }];
      // 0025/A2 (retained, off by default): `analyze` answers a DIFFERENT
      // question — unused/undeclared dependencies — that `tree` does not. Kept
      // behind a flag rather than deleted, and never on by default because of
      // the `target/` mutation above.
      if (mavenAnalyze) {
        specs.push({ tool: "mvn-dependency-analyze", argv: ["mvn", "-B", "-f", target, "dependency:analyze"], artifact: "mvn-dependency-analyze.txt", guard: "mvn", allowNonZero: true });
      }
      return specs;
    }
    case "golang":
      return [
        { tool: "go-list-updates", argv: ["go", "list", "-u", "-m", "all"], artifact: "go-list-updates.txt", guard: "go", allowNonZero: true },
        { tool: "go-mod-graph", argv: ["go", "mod", "graph"], artifact: "go-mod-graph.txt", guard: "go", allowNonZero: true, parse: "go-mod-graph" },
      ];
    default:
      return [];
  }
}
