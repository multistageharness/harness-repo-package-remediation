/**
 * src/manifest-deps.mjs — zero-dependency per-ecosystem manifest dependency
 * extractors (renovate-harness-enhancements Epic 02, feature 02/01; record
 * 0019/D1). The bash presence-scanner tells the pipeline "npm exists" but not
 * one dependency name or version — these extractors read the manifests
 * themselves, emitting one structured record per declared dependency:
 *
 *   { name, currentValue, depType, datasource, manifestPath }
 *
 * Modeled on Renovate's managers (npm section walk; go.mod line-parser with
 * require-block state and the `go` directive as a pseudo-dependency), minus
 * lockfiles/registries/workspaces (out of scope for v1). Offline, direct-deps
 * only — this surface feeds the remediate stage and stays mock-clean; the
 * step-9 depgraph CLI artifacts are the separate real-run-only diagnostics
 * surface (0019/D1 two-surface relationship). Degrade-don't-throw throughout,
 * matching the vendored `parseReport` convention.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Walk package.json's dependency sections → one record per entry. */
export function extractNpmDependencies(manifestText, manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return { deps: [], error: "unparseable package.json" };
  }
  const deps = [];
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const table = manifest?.[section];
    if (table === null || typeof table !== "object") continue;
    for (const [name, value] of Object.entries(table)) {
      if (typeof value === "string") {
        deps.push({ name, currentValue: value, depType: section, datasource: "npm", manifestPath });
      } else {
        // never dropped silently — e.g. workspace objects
        deps.push({ name, currentValue: null, depType: section, datasource: "npm", manifestPath, skipReason: "non-string version" });
      }
    }
  }
  return { deps, error: null };
}

/**
 * Line-oriented go.mod parser: single-line `require m v`, multi-line
 * `require ( … )` blocks (open/close state), `// indirect` marking, and the
 * `go 1.x` directive as a pseudo-dependency. module/replace/exclude/toolchain
 * lines and comments are ignored for v1. Never throws.
 */
export function extractGoModDependencies(manifestText, manifestPath) {
  const deps = [];
  let inRequireBlock = false;
  for (const rawLine of String(manifestText ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("//")) continue;
    if (inRequireBlock) {
      if (/^\)\s*$/.test(line)) {
        inRequireBlock = false;
        continue;
      }
      const m = line.match(/^(\S+)\s+(\S+)(\s*\/\/\s*indirect)?/);
      if (m) deps.push({ name: m[1], currentValue: m[2], depType: "require", datasource: "go", manifestPath, indirect: Boolean(m[3]) });
      continue;
    }
    if (/^require\s*\(\s*$/.test(line)) {
      inRequireBlock = true;
      continue;
    }
    const single = line.match(/^require\s+(\S+)\s+(\S+)(\s*\/\/\s*indirect)?/);
    if (single) {
      deps.push({ name: single[1], currentValue: single[2], depType: "require", datasource: "go", manifestPath, indirect: Boolean(single[3]) });
      continue;
    }
    const goDirective = line.match(/^go\s+(\S+)\s*$/);
    if (goDirective) {
      // a real toolchain constraint, not noise (Renovate's treatment)
      deps.push({ name: "go", currentValue: goDirective[1], depType: "golang", datasource: "golang-version", manifestPath });
    }
  }
  return { deps, error: null };
}

/**
 * Regex-walk a pom.xml's `<dependency>` blocks → one record per dependency
 * (0032/D3 — the maven reader `manifest-deps` never had; run `a52fbfa5`
 * extracted `(none)` for every maven repo because of it). Blocks inside
 * `<dependencyManagement>` carry depType "dependencyManagement"; a `<scope>`
 * tag otherwise names the depType (default "dependencies"). Property-valued
 * versions (`${log4j.version}`) are RECORDED with a skipReason, never dropped.
 */
export function extractMavenDependencies(manifestText, manifestPath) {
  const text = String(manifestText ?? "");
  const deps = [];
  const dmMatch = text.match(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/);
  const dmStart = dmMatch ? text.indexOf(dmMatch[0]) : -1;
  const dmEnd = dmMatch ? dmStart + dmMatch[0].length : -1;
  const re = /<dependency>[\s\S]*?<\/dependency>/g;
  for (;;) {
    const m = re.exec(text);
    if (m === null) break;
    const block = m[0];
    const g = block.match(/<groupId>\s*([^<]+?)\s*<\/groupId>/)?.[1];
    const a = block.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/)?.[1];
    if (!g || !a) continue;
    const version = block.match(/<version>\s*([^<]*?)\s*<\/version>/)?.[1] ?? null;
    const scope = block.match(/<scope>\s*([^<]+?)\s*<\/scope>/)?.[1] ?? null;
    const inDm = dmStart !== -1 && m.index > dmStart && m.index < dmEnd;
    const record = {
      name: `${g}:${a}`,
      currentValue: version,
      depType: inDm ? "dependencyManagement" : scope ?? "dependencies",
      datasource: "maven",
      manifestPath,
    };
    if (version === null) record.skipReason = "version managed elsewhere";
    else if (version.includes("${")) record.skipReason = "property-valued version";
    deps.push(record);
  }
  return { deps, error: null };
}

/**
 * Line-oriented requirements.txt parser (0032/D3 — the python reader whose
 * absence made `batch-jsonl-pip`'s DIRECT `jinja2==3.1.0` skip as "not in
 * extracted dependencies"). `name[extras]<op>version` lines only; comments,
 * `-r`/`-e`/option lines, and bare names are ignored for v1. Never throws.
 */
export function extractPipRequirements(manifestText, manifestPath) {
  const deps = [];
  for (const rawLine of String(manifestText ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("-")) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(==|>=|~=|<=|!=|>|<)\s*([^\s#;]+)/);
    if (!m) continue;
    deps.push({ name: m[1], currentValue: `${m[3] === "==" ? "" : m[3]}${m[4]}`.replace(/^==/, ""), depType: "dependencies", datasource: "pypi", manifestPath, operator: m[3] });
  }
  return { deps, error: null };
}

/**
 * Minimal pyproject.toml reader (0032/D3): the PEP 621 `[project]`
 * `dependencies = [...]` array plus `[tool.poetry.dependencies]` `name = "…"`
 * tables. A strict subset — anything it cannot read is simply absent, and the
 * requirements.txt reader remains the primary python surface.
 */
export function extractPyprojectDependencies(manifestText, manifestPath) {
  const text = String(manifestText ?? "");
  const deps = [];
  const push = (name, value) => {
    const m = String(value).trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(==|>=|~=|<=|!=)?\s*([^\s#;,]*)/);
    if (!m) return;
    deps.push({ name: name ?? m[1], currentValue: m[4] || null, depType: "dependencies", datasource: "pypi", manifestPath, ...(m[3] && m[3] !== "==" ? { operator: m[3] } : {}) });
  };
  const arr = text.match(/\ndependencies\s*=\s*\[([\s\S]*?)\]/);
  if (arr) {
    for (const item of arr[1].split(",")) {
      const quoted = item.trim().match(/^["']([^"']+)["']$/);
      if (quoted) push(null, quoted[1]);
    }
  }
  const poetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (poetry) {
    for (const rawLine of poetry[1].split("\n")) {
      const line = rawLine.trim();
      const kv = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*["']([^"']+)["']/);
      if (kv && kv[1] !== "python") deps.push({ name: kv[1], currentValue: kv[2], depType: "dependencies", datasource: "pypi", manifestPath });
    }
  }
  return { deps, error: null };
}

// Ordered manifest readers — adding an ecosystem is a one-element addition.
const MANIFEST_READERS = [
  { file: "package.json", extract: extractNpmDependencies },
  { file: "go.mod", extract: extractGoModDependencies },
  { file: "pom.xml", extract: extractMavenDependencies },
  { file: "requirements.txt", extract: extractPipRequirements },
  { file: "pyproject.toml", extract: extractPyprojectDependencies },
];

/** Directories never scanned for sub-module manifests (0032/D3 recursion). */
const RECURSE_SKIP = new Set(["node_modules", ".git", ".venv", ".venv-deptry", "target", "dist", "build", "vendor", "__pycache__"]);

/**
 * Shared async entry point: read each known root manifest under `repoDir` and
 * concatenate its records. Missing/unreadable files are skipped; per-manifest
 * parse errors aggregate into `errors`. Never throws.
 *
 * 0032/D3: `recurseSubmodules` additionally scans ONE bounded level of child
 * directories (multi-module repos like multi-repo-npm declare deps only in
 * repo-a/ / repo-b/), emitting `manifestPath: "<sub>/<file>"` records.
 *
 * 0065/A3: OFF by default, but BOTH real callers now opt in — `commands.repoFingerprint`
 * and `commands.resolveDatasource` pass `recurseSubmodules: true`, sharing this ONE
 * walk so they cannot drift. (Until 0065 the doc here claimed "the fingerprint atom
 * opts in via its own param" — it did not. No caller passed the flag, so the whole
 * capability was dead code and multi-repo-npm carried zero deps.)
 */
export async function extractManifestDependencies(repoDir, { recurseSubmodules = false, maxSubdirs = 50 } = {}) {
  const dependencies = [];
  const errors = [];
  const readInto = async (dir, prefix) => {
    for (const { file, extract } of MANIFEST_READERS) {
      const text = await readFile(join(dir, file), "utf8").catch(() => null);
      if (text === null) continue;
      const { deps, error } = extract(text, prefix ? `${prefix}/${file}` : file);
      dependencies.push(...deps);
      if (error) errors.push(error);
    }
  };
  await readInto(repoDir, "");
  if (recurseSubmodules) {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(repoDir, { withFileTypes: true }).catch(() => []);
    let scanned = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || RECURSE_SKIP.has(entry.name)) continue;
      if (scanned >= maxSubdirs) {
        errors.push(`submodule scan truncated at ${maxSubdirs} directories`);
        break;
      }
      scanned += 1;
      await readInto(join(repoDir, entry.name), entry.name);
    }
  }
  return { dependencies, errors };
}

/**
 * Deterministic slug-keyed stub dependencies for mock/failed/missing-dir
 * fingerprint entries (0019/A2) — so remediate logic stays exercisable under
 * `--mock`. Rule: char-code sum of the dir string even → two fixed npm
 * records (a dependency + a devDependency), odd → the first record only.
 * Stable across runs, no I/O.
 */
export function stubDependencies(dir) {
  const sum = Array.from(String(dir ?? "")).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const records = [
    { name: "harness-mock-pkg", currentValue: "1.0.0", depType: "dependencies", datasource: "npm", manifestPath: "package.json" },
    { name: "harness-mock-tool", currentValue: "2.3.4", depType: "devDependencies", datasource: "npm", manifestPath: "package.json" },
  ];
  return sum % 2 === 0 ? records : records.slice(0, 1);
}
