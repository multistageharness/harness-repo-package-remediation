/**
 * src/tool-registry.mjs — the central REMEDIATION TOOL registry loader
 * (langgraph-flow.md capability 2). Discovers every `*.tool.json` manifest under
 * a central tools directory (`harness-repo-package-remediation/tools/` by default), validates each against
 * the tool contract, and exposes them grouped by ecosystem so the plan
 * (`commands.remediationPlan`) and the LLM prompt optimizer (`skills.optimizePrompt`)
 * can hand language-specific tools to the SDK.
 *
 * The tools are DECLARATIVE DATA, not executable modules — this loader never
 * imports them (that is the registry/mapping's job for atoms). It only reads +
 * validates JSON, so it stays outside the mapping trust boundary and may read the
 * repo-root `harness-repo-package-remediation/tools/` directory that lives OUTSIDE the pack.
 *
 * DIRECTORY RESOLUTION (user CLAUDE.md path convention — never a host-absolute
 * path baked in): an explicit `dir` argument wins, then `$HARNESS_TOOLS_DIR`,
 * then a path resolved relative to THIS module (`../../../tools` → the repo-root
 * `harness-repo-package-remediation/tools/`). The module-relative fallback is robust to the invocation cwd.
 *
 * SECURITY (v100 security rule §4): an `argv_template` is a list of literal
 * string tokens; no token may carry a shell metacharacter. A tool that violates
 * this is REJECTED (recorded in `errors[]`), never loaded — argv lists must stay
 * structurally un-shell-able even as advisory data.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The ecosystem groups a tool may be tagged for (mirrors ECOSYSTEM_GROUPS). */
export const TOOL_ECOSYSTEMS = Object.freeze(["node", "python", "java", "golang", "rust", "docker", "other"]);

/**
 * The package managers a tool may key on (change record 0033/A1) — an
 * ORTHOGONAL, optional dimension finer than the ecosystem group: npm and pnpm
 * are both `node`; pip/poetry/uv/conda are all `python`. Version-discovery
 * tools (`kind: "version-discovery"`) set it so nine per-package-manager
 * finders can coexist inside six lane groups; remediation tools omit it and
 * validate exactly as before.
 */
export const TOOL_PACKAGE_MANAGERS = Object.freeze(["npm", "pnpm", "pip", "poetry", "uv", "conda", "maven", "cargo", "docker"]);

/**
 * The version GRAMMAR a version-discovery tool is governed by (change record
 * 0037/D3) — optional metadata that makes each lane's ordering/stability rule
 * explicit and reviewable instead of implicit in the adapter table.
 *
 * 0037/D3 proposed `semver | dotted | docker`; `dotted` is split here because
 * the same record's A2 gave maven and PEP 440 DIFFERENT stability rules over
 * the one shared comparator — an unknown tail (`-jre`) is a release classifier
 * for maven and a non-release for PEP 440. A single `dotted` value could not
 * name which of the two a lane means.
 */
export const TOOL_VERSIONINGS = Object.freeze(["semver", "pep440", "maven", "docker"]);

/** Shell metacharacters that must never appear in an argv token (security §4). */
const FORBIDDEN_TOKEN_CHARS = /[&|;<>`\n]/;

/** The default tools dir: repo-root `harness-repo-package-remediation/tools/`, resolved off this module. */
export function defaultToolsDir(env = process.env) {
  if (typeof env.HARNESS_TOOLS_DIR === "string" && env.HARNESS_TOOLS_DIR.length > 0) {
    return env.HARNESS_TOOLS_DIR;
  }
  // src/ → pack root → vendors → harness → tools
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools");
}

/** Recursively collect `*.tool.json` files under `dir`. */
function collectManifests(dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectManifests(full, acc);
    else if (entry.endsWith(".tool.json")) acc.push(full);
  }
  return acc;
}

/**
 * Validate one parsed manifest against the tool contract.
 * @returns {string[]} a (possibly empty) list of human-readable problems.
 */
export function validateTool(tool, where = "tool") {
  const problems = [];
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return [`${where}: manifest must be an object`];
  for (const field of ["id", "ecosystem", "kind", "title", "description"]) {
    if (typeof tool[field] !== "string" || tool[field].length === 0) problems.push(`${where}: '${field}' must be a non-empty string`);
  }
  if (typeof tool.ecosystem === "string" && !TOOL_ECOSYSTEMS.includes(tool.ecosystem)) {
    problems.push(`${where}: ecosystem '${tool.ecosystem}' is not one of ${TOOL_ECOSYSTEMS.join(" | ")}`);
  }
  // 0033/A1: `packageManager` is OPTIONAL — absent validates exactly as before;
  // present, it must name a known package manager.
  if (tool.packageManager !== undefined && !TOOL_PACKAGE_MANAGERS.includes(tool.packageManager)) {
    problems.push(`${where}: packageManager '${tool.packageManager}' is not one of ${TOOL_PACKAGE_MANAGERS.join(" | ")}`);
  }
  // 0037/D3: `versioning` is OPTIONAL, on the same precedent as packageManager.
  if (tool.versioning !== undefined && !TOOL_VERSIONINGS.includes(tool.versioning)) {
    problems.push(`${where}: versioning '${tool.versioning}' is not one of ${TOOL_VERSIONINGS.join(" | ")}`);
  }
  for (const listField of ["capabilities", "manifests", "produces"]) {
    if (tool[listField] !== undefined) {
      if (!Array.isArray(tool[listField]) || tool[listField].some((t) => typeof t !== "string")) {
        problems.push(`${where}: '${listField}' must be a list of strings`);
      }
    }
  }
  if (tool.argv_template !== undefined) {
    if (!Array.isArray(tool.argv_template) || tool.argv_template.length === 0) {
      problems.push(`${where}: 'argv_template' must be a non-empty list`);
    } else {
      for (const token of tool.argv_template) {
        if (typeof token !== "string") problems.push(`${where}: argv_template tokens must be literal strings`);
        else if (FORBIDDEN_TOKEN_CHARS.test(token)) problems.push(`${where}: argv token ${JSON.stringify(token)} carries shell metacharacters (security rule §4)`);
      }
    }
  }
  return problems;
}

/**
 * Load + validate every tool manifest under the tools directory.
 * @param {string} [dir] override the tools directory (else env / module-relative)
 * @returns {{dir: string, tools: object[], byEcosystem: Map<string, object[]>, errors: {path: string, problems: string[]}[]}}
 */
export function loadToolRegistry(dir = defaultToolsDir()) {
  const files = collectManifests(dir, []).sort();
  const tools = [];
  const errors = [];
  const seenIds = new Set();
  for (const path of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      errors.push({ path, problems: [`unparseable JSON: ${err.message}`] });
      continue;
    }
    const problems = validateTool(parsed, path);
    if (typeof parsed?.id === "string" && seenIds.has(parsed.id)) problems.push(`duplicate tool id '${parsed.id}'`);
    if (problems.length > 0) {
      errors.push({ path, problems });
      continue;
    }
    seenIds.add(parsed.id);
    tools.push({ ...parsed, source: path });
  }
  // Deterministic order — by ecosystem then id — so plans/prompts are stable.
  tools.sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.id.localeCompare(b.id));
  const byEcosystem = new Map();
  for (const eco of TOOL_ECOSYSTEMS) byEcosystem.set(eco, []);
  for (const tool of tools) byEcosystem.get(tool.ecosystem).push(tool);
  return { dir, tools, byEcosystem, errors };
}

/**
 * The tools tagged for one ecosystem group, plus the `other` fallbacks so every
 * ecosystem always has at least the generic manifest-edit tool.
 * @param {ReturnType<typeof loadToolRegistry>} registry
 * @param {string} group  node | python | java | golang | docker | other
 * @returns {object[]}
 */
export function toolsForEcosystem(registry, group) {
  const own = registry.byEcosystem.get(group) ?? [];
  if (group === "other") return own.slice();
  const generic = registry.byEcosystem.get("other") ?? [];
  return [...own, ...generic];
}
