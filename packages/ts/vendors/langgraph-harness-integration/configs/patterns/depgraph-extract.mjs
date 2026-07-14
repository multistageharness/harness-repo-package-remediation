/**
 * commands.depgraphExtract — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the step-9 per-ecosystem
 * dependency-graph extractor (`langgraph-flow.md` step 10; change records
 * 0017/D1 → 0018/A1+D2 → 0019/A1/A4 → 0025/A1+A2+A3+D1+D3).
 *
 * This is the per-ecosystem leaf of the step-9 `dependency_graph` sub-langgraph
 * (`configs/flows/dependency-graph.yaml`): the child flow's `nodes.router` reads
 * a repo's detected `dominantEcosystem` off its fingerprint and an `edges.switch`
 * routes it to the matching extractor NODE. Every one of those six lanes
 * (java · python · node · docker · golang · other) is THIS atom, parametrized by
 * an `ecosystem` group — the growth rule's "one atom file + one mapping line",
 * reused per lane rather than six near-identical modules. The per-ecosystem
 * knowledge (toolchain sub-detect + 0018's command matrix) lives in
 * `src/ecosystem-registry.mjs` (0019/A4 — single source, no drifting tables).
 *
 * Real-vs-mock contract (0018/A1):
 * - Under `--mock` (default) the atom returns the SAME deterministic stub the
 *   0017 placeholder committed to — `{ placeholder: true, ecosystem, toolchain,
 *   repo, url, dir, dominantEcosystem, nodes: [], edges: [] }` — no fs,
 *   subprocess, network, or LLM, so the acceptance contract holds byte-for-byte.
 * - On real (`MOCK=false`) runs it executes the registry's per-ecosystem
 *   command matrix inside the repo's clone dir: argv-list subprocesses only
 *   (security rule 4), each with a bounded timeout (platform rule 4), guarded
 *   IF-clone-succeeded-AND-CLI-present-ELSE-SKIP (0018 A1 §2 as extended by
 *   0019/A1 — a failed clone records `{ skipped: "clone-failed", errorClass }`
 *   and runs nothing). Every command's raw stdout is saved to its own artifact
 *   file under `<save_dir>/<repo>/` (0018/D2, default
 *   `.harness/dependency-graphs/`), with a `<artifact>.stderr.txt` sibling when
 *   stderr is non-empty (0025/D1), and the graph-yielding tools (`npm list
 *   --json`, `go mod graph`, `pipdeptree --json`, `mvn dependency:tree
 *   -DoutputType=json`) are additionally parsed into `{ nodes, edges }`
 *   (0018 A1 §5 as extended by 0025/D3). docker/other lanes have no command
 *   matrix and retain the placeholder stub on every path.
 *
 * Exit-code honesty (0025/A1): every spec carries `allowNonZero: true` so the
 * atom never throws — but a non-zero exit is a RECORDED OUTCOME. Each command
 * record carries `ok`, and the result carries `status` ("ok" | "failed" |
 * "skipped") + `failed`. `{ placeholder: false, nodes: [], edges: [] }` is no
 * longer indistinguishable from a Maven `BUILD FAILURE`.
 *
 * Module awareness (0025/A3): a repo may hold more than one project. The
 * fingerprint's `primary-manifest` signals are turned into execution units by
 * `src/repo-modules.mjs`; the lanes `isModuleAware` declares run one invocation
 * per module (artifacts nested under `<module-slug>/`), every other lane runs
 * once at the clone root exactly as before. The fan-out is capped by
 * `max_modules` (default 25) and a truncation is recorded, never silent.
 *
 * The python lane's `deptry`/`pipdeptree` come from the venv provisioned by
 * `commands.venvSetup` (0018/D1) via the `venv_from` channel.
 *
 * Trust boundary: lives under `configs/patterns/`; imports only the pack's own
 * `src/` bridges (`sdk.mjs` for runArgv, `ecosystem-registry.mjs`).
 */

import { access, mkdir, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join, resolve, sep } from "node:path";

import { runArgv } from "../../src/sdk.mjs";
import { detectToolchain, depgraphCommands, isModuleAware } from "../../src/ecosystem-registry.mjs";
import { repoModules, moduleSlug, ROOT_MODULE } from "../../src/repo-modules.mjs";

/** 0025/A3: bound the per-module fan-out — each module costs one 120s timeout. */
const DEFAULT_MAX_MODULES = 25;

export const meta = {
  name: "commands.depgraphExtract",
  category: "commands",
  summary: "Per-ecosystem dependency-graph extractor: real per-toolchain CLI analysis + saved artifacts on MOCK=false (guarded, argv-list, bounded, module-aware, exit-code honest); deterministic placeholder stub under mock.",
  params: {
    type: "object",
    required: ["ecosystem", "fingerprint_from", "into"],
    properties: {
      // The ecosystem GROUP this lane serves — java | python | node | docker |
      // golang | other (the switch case that routed here).
      ecosystem: { type: "string", minLength: 1 },
      // Channel holding ONE fingerprint entry ({ url, dir, fingerprint, … }).
      fingerprint_from: { type: "string", minLength: 1 },
      // Channel the per-repo graph/result is written into.
      into: { type: "string", minLength: 1 },
      // $PATH_TO_SAVE_DIRECTORY (0018/D2): root for per-repo raw-output
      // artifacts, resolved against the flow dir. Parameterized — never a
      // host-absolute path in yaml.
      save_dir: { type: "string" },
      // Channel holding the commands.venvSetup result ({ venv, bin, … }) —
      // wired on the python lane only (0018/D1).
      venv_from: { type: "string" },
      // 0025/A3: cap the module fan-out on module-aware lanes. A truncated
      // fan-out is RECORDED (`modulesTruncated`), never silent.
      max_modules: { type: "integer", minimum: 1 },
      // 0025/A2: `mvn dependency:analyze` answers a different question than
      // `dependency:tree` (unused/undeclared deps) but MUTATES the clone — it
      // triggers `test-compile` and creates `target/`. Off by default.
      maven_analyze: { type: "boolean" },
    },
  },
  returns: "node",
};

const exists = (path) => access(path).then(() => true, () => false);

/** PATH probe — a path-y guard (contains a separator) is checked directly. */
async function defaultProbe(bin) {
  if (bin.includes(sep) || bin.includes("/")) return exists(bin);
  for (const d of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    if (await exists(join(d, bin))) return true;
  }
  return false;
}

/** npm list --json → nodes/edges (recursive dependencies tree). */
export function parseNpmList(stdout) {
  let doc;
  try {
    doc = JSON.parse(stdout);
  } catch {
    return null;
  }
  const nodes = new Map();
  const edges = [];
  const idOf = (name, info) => `${name}@${info?.version ?? "unknown"}`;
  const walk = (name, info) => {
    const id = idOf(name, info);
    if (!nodes.has(id)) nodes.set(id, { id, name, version: info?.version ?? null });
    for (const [depName, depInfo] of Object.entries(info?.dependencies ?? {})) {
      edges.push({ from: id, to: idOf(depName, depInfo) });
      walk(depName, depInfo);
    }
  };
  walk(doc?.name ?? "root", doc ?? {});
  return { nodes: [...nodes.values()], edges };
}

/** go mod graph → nodes/edges (one "parent child" pair per line). */
export function parseGoModGraph(stdout) {
  const nodes = new Map();
  const edges = [];
  for (const line of String(stdout ?? "").split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(\S+)$/);
    if (!m) continue;
    for (const id of [m[1], m[2]]) {
      if (!nodes.has(id)) {
        const at = id.lastIndexOf("@");
        nodes.set(id, { id, name: at > 0 ? id.slice(0, at) : id, version: at > 0 ? id.slice(at + 1) : null });
      }
    }
    edges.push({ from: m[1], to: m[2] });
  }
  return { nodes: [...nodes.values()], edges };
}

/** pipdeptree --json → nodes/edges (flat package + dependencies records). */
export function parsePipdeptree(stdout) {
  let doc;
  try {
    doc = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(doc)) return null;
  const nodes = new Map();
  const edges = [];
  const idOf = (name, version) => `${name}@${version ?? "unknown"}`;
  for (const record of doc) {
    const pkg = record?.package ?? {};
    const from = idOf(pkg.package_name ?? pkg.key ?? "unknown", pkg.installed_version);
    if (!nodes.has(from)) nodes.set(from, { id: from, name: pkg.package_name ?? pkg.key ?? "unknown", version: pkg.installed_version ?? null });
    for (const dep of record?.dependencies ?? []) {
      const to = idOf(dep.package_name ?? dep.key ?? "unknown", dep.installed_version);
      if (!nodes.has(to)) nodes.set(to, { id: to, name: dep.package_name ?? dep.key ?? "unknown", version: dep.installed_version ?? null });
      edges.push({ from, to });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/**
 * `mvn dependency:tree -DoutputType=json` → nodes/edges (0025/D3 — un-defers the
 * follow-up 0018/A1 §5 explicitly deferred). The JSON visitor emits ONE nested
 * `children` tree rooted at the project itself; ids are Maven coordinates.
 */
export function parseMavenTree(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || typeof doc.groupId !== "string" || typeof doc.artifactId !== "string") return null;
  const nodes = new Map();
  const edges = [];
  const idOf = (n) => `${n.groupId}:${n.artifactId}:${n.version ?? "unknown"}`;
  const walk = (n) => {
    const id = idOf(n);
    if (!nodes.has(id)) nodes.set(id, { id, name: `${n.groupId}:${n.artifactId}`, version: n.version ?? null });
    for (const child of Array.isArray(n.children) ? n.children : []) {
      if (typeof child?.groupId !== "string" || typeof child?.artifactId !== "string") continue;
      edges.push({ from: id, to: idOf(child) });
      walk(child);
    }
  };
  walk(doc);
  return { nodes: [...nodes.values()], edges };
}

const PARSERS = { "npm-list": parseNpmList, "go-mod-graph": parseGoModGraph, pipdeptree: parsePipdeptree, "maven-tree": parseMavenTree };

// node-lane lockfiles: detected file → saved artifact name (0018 A1 §4).
const LOCKFILES = [
  ["package-lock.json", "lockfile.json"],
  ["yarn.lock", "lockfile.lock"],
  ["pnpm-lock.yaml", "lockfile.yaml"],
];

/** Test seam: build the factory over an injected argv runner + CLI probe. */
export function _depgraphExtractWith({ runner = runArgv, probe = defaultProbe } = {}) {
  return function depgraphExtractFactory(params, ctx) {
    return async (state) => {
      const entry = state[params.fingerprint_from] ?? {};
      const fp = entry.fingerprint ?? {};
      const url = typeof entry.url === "string" ? entry.url : null;
      const dir = typeof entry.dir === "string" ? entry.dir : null;
      const repo = typeof dir === "string" && dir.length > 0 ? basename(dir) : "unknown";
      const toolchain = detectToolchain(params.ecosystem, fp);

      // One bounded, idempotent progress tick per extracted repo — reuses the
      // known `loop.guard` event with a `kind: "stage"` discriminator (same seam
      // repo-fingerprint.mjs uses; no pristine-SDK edit, stays in the pack's
      // trust boundary).
      ctx.emit?.("loop.guard", { node: ctx.node?.id, count: 1, max: 1, kind: "stage" });

      // The 0017 stub shape — the mock return AND the base every real/skip
      // result extends, so downstream consumers see one stable shape.
      const stub = {
        placeholder: true,
        ecosystem: params.ecosystem,
        toolchain,
        repo,
        url,
        dir,
        dominantEcosystem: typeof fp.dominantEcosystem === "string" ? fp.dominantEcosystem : null,
        nodes: [],
        edges: [],
      };

      // Mock (default): byte-identical to the 0017 placeholder — no fs,
      // subprocess, network, or LLM (acceptance contract, platform rule 3).
      if (ctx.options.mock) return { [params.into]: stub };

      // 0019/A1 skip guard (extends 0018 A1 §2): a failed clone has no working
      // tree — record the skip + class, run nothing.
      if (typeof entry.cloneError === "string" && entry.cloneError.length > 0) {
        return { [params.into]: { ...stub, skipped: "clone-failed", errorClass: entry.cloneError } };
      }

      const venvState = params.venv_from ? state[params.venv_from] ?? {} : {};
      const venvBin = typeof venvState.bin === "string" ? venvState.bin : null;
      // 0026/A4: when the step-10 install playbook provisioned the repo's own
      // env (`<clone>/.venv`), point pipdeptree's `--python` at it so the
      // enumerated closure is the REPO's, not the tooling venv's. Absent an
      // install (skipped/failed), pipdeptree falls back to its own env —
      // recorded honestly by the step-11 result either way.
      const installVenvPython = typeof dir === "string" && dir.length > 0 ? join(dir, ".venv", "bin", "python") : null;
      const pythonBin = installVenvPython && (await exists(installVenvPython)) ? installVenvPython : null;
      const commandOpts = { dir: dir ?? ".", venvBin, mavenAnalyze: params.maven_analyze === true, pythonBin };

      // 0025/A3: the repo may hold MORE THAN ONE project. The fingerprint knows
      // exactly where each manifest lives; `repoModules` turns that into the
      // execution units. Only the lanes `isModuleAware` declares actually fan
      // out — every other lane's tools resolve from the clone root, so they run
      // once against the root module exactly as they did pre-0025.
      const discovered = repoModules(fp, params.ecosystem);
      const fanOut = isModuleAware(params.ecosystem, toolchain);
      const maxModules = Number.isInteger(params.max_modules) && params.max_modules > 0 ? params.max_modules : DEFAULT_MAX_MODULES;
      const modules = fanOut ? discovered.slice(0, maxModules) : [{ ...ROOT_MODULE }];
      const droppedModules = fanOut ? discovered.slice(maxModules).map((m) => m.dir) : [];

      // docker / other: no command matrix requested (0018 A1 §4) — placeholder.
      if (depgraphCommands(params.ecosystem, toolchain, { ...commandOpts, module: modules[0] }).length === 0) {
        return { [params.into]: stub };
      }

      if (typeof dir !== "string" || dir.length === 0 || !(await exists(dir))) {
        return { [params.into]: { ...stub, skipped: "no-clone-dir" } };
      }

      // $PATH_TO_SAVE_DIRECTORY, keyed per repo so parallel Send branches
      // never collide (0018/D2), and per MODULE below so a fanned-out lane's
      // branches never overwrite each other (0025/A3).
      const saveRel = params.save_dir ?? "../../.harness/dependency-graphs";
      const saveRoot = isAbsolute(saveRel) ? saveRel : resolve(ctx.options.baseDir, saveRel);
      const artifactsDir = join(saveRoot, repo);
      await mkdir(artifactsDir, { recursive: true });

      const commands = [];
      const nodes = [];
      const edges = [];

      // A truncated fan-out NAMES what it dropped — silent truncation would
      // reproduce exactly the class of bug 0025/A1 fixes. Reuses the known
      // `loop.guard` event (unknown types throw in the vendored hub).
      if (droppedModules.length > 0) {
        ctx.emit?.("loop.guard", { node: ctx.node?.id, count: modules.length, max: discovered.length, kind: "module-cap", dropped: droppedModules });
      }

      // node lane extra deliverable: copy the detected lockfile (0018 A1 §4).
      if (params.ecosystem === "node") {
        for (const [file, artifact] of LOCKFILES) {
          if (await exists(join(dir, file))) {
            await copyFile(join(dir, file), join(artifactsDir, artifact));
            commands.push({ tool: "lockfile", copiedFrom: file, artifact: join(artifactsDir, artifact) });
            break;
          }
        }
      }

      for (const module of modules) {
        // Root module → FLAT artifacts (0018/D2's layout, every single-project
        // repo unchanged); nested module → its own sub-directory.
        const slug = moduleSlug(module);
        const moduleDir = slug ? join(artifactsDir, slug) : artifactsDir;
        if (slug) await mkdir(moduleDir, { recursive: true });
        const specs = depgraphCommands(params.ecosystem, toolchain, { ...commandOpts, module, outDir: moduleDir });

        for (const spec of specs) {
          let argv = spec.argv;
          // IF-CLI-present-ELSE-SKIP (0018 A1 §2); java/gradle prefers the
          // repo-local ./gradlew wrapper and falls back to gradle on PATH (§6).
          if (!(await probe(spec.guard))) {
            if (spec.fallbackArgv && (await probe(spec.fallbackGuard))) {
              argv = spec.fallbackArgv;
            } else {
              commands.push({ tool: spec.tool, module: module.dir, skipped: spec.fallbackGuard ?? spec.guard, reason: "not on PATH" });
              continue;
            }
          }
          if (spec.needsEntryFile) {
            const entryFile = await detectNodeEntryFile(dir);
            if (!entryFile) {
              commands.push({ tool: spec.tool, module: module.dir, skipped: spec.tool, reason: "no entry file" });
              continue;
            }
            argv = [...argv, "--directory", dir, entryFile];
          }
          // A `produces` file left behind by an EARLIER run would otherwise be
          // read back as if this run had written it — a failed extraction would
          // report a stale graph. Remove it first so the read below is honest.
          if (spec.produces) await rm(spec.produces, { force: true });
          const { stdout, stderr, exitCode } = await runner(argv, { cwd: dir, timeoutMs: 120000, allowNonZero: spec.allowNonZero === true });
          const artifact = join(moduleDir, spec.artifact);
          await writeFile(artifact, stdout ?? "", "utf8");

          // 0025/A1: a non-zero exit is a RECORDED OUTCOME, never silence.
          // `allowNonZero` stays — the atom must not throw — but "the tool ran
          // and found nothing" and "the tool failed" stop being the same result.
          const record = { tool: spec.tool, module: module.dir, argv, artifact, exitCode, ok: exitCode === 0 };
          if (spec.produces) record.produced = spec.produces;

          // 0025/D1: stderr to a SIBLING file (only when non-empty), so the
          // PARSERS keep receiving clean stdout. Maven happens to log its errors
          // to stdout — a tool that doesn't would otherwise leave no trace.
          if (typeof stderr === "string" && stderr.length > 0) {
            record.stderrArtifact = `${artifact}.stderr.txt`;
            await writeFile(record.stderrArtifact, stderr, "utf8");
          }
          commands.push(record);

          // 0025/A2: `produces` names a file the TOOL wrote (mvn's `-DoutputFile`);
          // parse that instead of stdout, which carries only the build log.
          const source = spec.produces ? await readFile(spec.produces, "utf8").catch(() => null) : stdout;
          const parsed = spec.parse && typeof source === "string" ? PARSERS[spec.parse]?.(source) : null;
          if (parsed) {
            nodes.push(...parsed.nodes);
            edges.push(...parsed.edges);
          }
        }
      }

      // 0025/A1: the single source of truth for the outcome, rather than an
      // inference from emptiness. `{ placeholder:false, nodes:[], edges:[] }`
      // alongside `exitCode: 1` is now unreachable as a "successful" result.
      const ran = commands.filter((c) => typeof c.exitCode === "number");
      const failed = ran.some((c) => c.exitCode !== 0);
      const status = ran.length === 0 ? "skipped" : failed ? "failed" : "ok";
      const result = { ...stub, placeholder: false, status, failed, artifactsDir, modules, commands, nodes, edges };
      if (droppedModules.length > 0) result.modulesTruncated = { max: maxModules, discovered: discovered.length, dropped: droppedModules };
      return { [params.into]: result };
    };
  };
}

/** Entry file for the dependency-tree CLI: package.json `main`, else index.js. */
async function detectNodeEntryFile(dir) {
  const manifest = await readFile(join(dir, "package.json"), "utf8").then(JSON.parse).catch(() => null);
  const candidate = typeof manifest?.main === "string" && manifest.main.length > 0 ? manifest.main : "index.js";
  return (await exists(join(dir, candidate))) ? candidate : null;
}

export const depgraphExtract = _depgraphExtractWith({});
