/**
 * mapping/mapping-loader.mjs — stage 2 of the pipeline: pattern name →
 * module reference.
 *
 * A mapping yaml declares, for every pattern name a flow may `uses:`, which
 * Node ESM module implements it and which export is the factory:
 *
 *   version: 100
 *   extends: default            # layer on the SDK's built-in mapping
 *   patterns:
 *     nodes.llm:      { module: "@internal/langgraph-langchain-harness-sdk/atoms/nodes/llm.mjs", export: llmNode }
 *     acme.sentiment: { module: "./patterns/sentiment.mjs", export: sentiment, category: skills }
 *
 * Resolution rules:
 *   - bare specifiers must start with `@internal/langgraph-langchain-harness-` and resolve through Node's
 *     package-exports machinery (the SDK self-references its atoms);
 *   - `./` / `../` specifiers resolve RELATIVE TO THE MAPPING FILE and must
 *     stay inside the mapping file's directory subtree — `../` escapes are a
 *     TrustBoundaryError (the mapping file's folder is the trust root);
 *   - overlays win: later mapping layers override earlier entries by name.
 *
 * The mapping is pure data — no imports happen here. Stage 3 (the registry)
 * performs the dynamic `import()`.
 */

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

import { MappingError, TrustBoundaryError } from "../errors.mjs";

const PATTERN_NAME_RE = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9_]*$/;
const ALLOWED_BARE_PREFIX = "@internal/langgraph-langchain-harness-";

/** Absolute path of the SDK's own default mapping yaml. */
export const DEFAULT_MAPPING_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "mapping.default.yaml");

/**
 * @typedef {Object} MappingEntry
 * @property {string} name       pattern name ("nodes.llm")
 * @property {string} category   name prefix ("nodes") or explicit override
 * @property {string} module     module specifier as written
 * @property {string} export     named export holding the factory
 * @property {string|null} file  absolute file path for relative entries (null for bare)
 * @property {string} origin     mapping file that contributed the entry
 */

export class Mapping {
  constructor(entries, layers) {
    /** @type {Map<string, MappingEntry>} */
    this.entries = entries;
    this.layers = layers;
  }
  get(name) {
    return this.entries.get(name) ?? null;
  }
  has(name) {
    return this.entries.has(name);
  }
  names() {
    return [...this.entries.keys()].sort();
  }
  byCategory() {
    const out = {};
    for (const entry of this.entries.values()) {
      (out[entry.category] ??= []).push(entry);
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  toJSON() {
    return {
      layers: this.layers,
      patterns: Object.fromEntries([...this.entries.entries()].map(([k, v]) => [k, { ...v }])),
    };
  }
}

function parseEntry(name, decl, mappingDir, origin, issues) {
  if (!PATTERN_NAME_RE.test(name)) {
    issues.push(`pattern name '${name}' is invalid (expected category.name, e.g. nodes.llm)`);
    return null;
  }
  if (decl == null || typeof decl !== "object" || typeof decl.module !== "string") {
    issues.push(`pattern '${name}': entry must be an object with a 'module' string`);
    return null;
  }
  const category = decl.category ?? name.split(".")[0];
  const exportName = decl.export ?? name.split(".")[1];
  const module = decl.module;

  let file = null;
  if (module.startsWith("./") || module.startsWith("../") || isAbsolute(module)) {
    const abs = resolve(mappingDir, module);
    const rel = relative(mappingDir, abs);
    // Trust boundary: relative modules must stay inside the mapping dir tree.
    if (rel.startsWith("..") || (isAbsolute(module) && rel.split(sep)[0] === "..")) {
      throw new TrustBoundaryError(
        `pattern '${name}': module '${module}' escapes the mapping directory — custom pattern files must live under ${mappingDir}`,
        { name, module, mappingDir },
      );
    }
    file = abs;
  } else if (!module.startsWith(ALLOWED_BARE_PREFIX)) {
    throw new TrustBoundaryError(
      `pattern '${name}': bare module specifier '${module}' is outside the allowed '@internal/langgraph-langchain-harness-' namespace`,
      { name, module },
    );
  }
  return { name, category, module, export: exportName, file, origin };
}

async function loadOneMappingFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new MappingError(`cannot read mapping file '${path}': ${err.message}`, { path });
  }
  let doc;
  try {
    doc = YAML.parse(text);
  } catch (err) {
    throw new MappingError(`mapping parse error in '${path}': ${err.message}`, { path });
  }
  if (!doc || typeof doc !== "object" || typeof doc.patterns !== "object") {
    throw new MappingError(`mapping file '${path}' must declare a 'patterns' map`, { path });
  }
  return doc;
}

/**
 * Load a mapping file (plus its `extends` chain) into a resolved Mapping.
 *
 * @param {string|null} mappingPath project mapping yaml; null → default only
 * @returns {Promise<Mapping>}
 */
export async function loadMapping(mappingPath = null) {
  const layerPaths = [];
  // Walk the extends chain (depth-first, default first).
  async function collect(path, depth) {
    if (depth > 5) throw new MappingError("mapping 'extends' chain too deep (max 5)", { path });
    const doc = await loadOneMappingFile(path);
    const ext = doc.extends;
    if (ext === "default" && path !== DEFAULT_MAPPING_PATH) {
      await collect(DEFAULT_MAPPING_PATH, depth + 1);
    } else if (typeof ext === "string" && ext !== "default") {
      await collect(resolve(dirname(path), ext), depth + 1);
    }
    layerPaths.push({ path, doc });
  }
  await collect(mappingPath ? resolve(mappingPath) : DEFAULT_MAPPING_PATH, 0);

  const entries = new Map();
  const issues = [];
  for (const { path, doc } of layerPaths) {
    const dir = dirname(path);
    for (const [name, decl] of Object.entries(doc.patterns)) {
      const entry = parseEntry(name, decl, dir, path, issues);
      if (entry) entries.set(name, entry); // later layers override
    }
  }
  if (issues.length > 0) {
    throw new MappingError(`mapping is invalid: ${issues[0]}${issues.length > 1 ? ` (+${issues.length - 1} more)` : ""}`, { issues });
  }
  return new Mapping(entries, layerPaths.map((l) => l.path));
}

/** Convert a MappingEntry into the specifier handed to dynamic import(). */
export function entryToImportSpecifier(entry) {
  if (entry.file) return pathToFileURL(entry.file).href;
  return entry.module; // bare @internal/langgraph-langchain-harness-... specifier — Node package exports resolve it
}
