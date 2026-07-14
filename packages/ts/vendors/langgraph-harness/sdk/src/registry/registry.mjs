/**
 * registry/registry.mjs — stage 3 of the pipeline: mapping entry →
 * imported, verified factory function.
 *
 * The registry is the ONLY place in langgraph-langchain-harness that performs dynamic `import()`.
 * Given a pattern name it:
 *   1. looks up the mapping entry (name → module + export),
 *   2. dynamically imports the module via Node ESM (`import()`),
 *   3. verifies the atom contract — the named export is a function and the
 *      module's `meta.name` / `meta.category` agree with the mapping,
 *   4. caches the binding (one import per module for the process lifetime).
 *
 * Because every atom is a dedicated file with one exported factory, the
 * registry is also the platform's introspection surface: `describe()` powers
 * the CLI `patterns` command, the backend `/api/patterns` endpoint, and the
 * generated docs.
 */

import { RegistryError } from "../errors.mjs";
import { entryToImportSpecifier } from "../mapping/mapping-loader.mjs";

export class Registry {
  /**
   * @param {import("../mapping/mapping-loader.mjs").Mapping} mapping
   */
  constructor(mapping) {
    this.mapping = mapping;
    /** @type {Map<string, {factory: Function, meta: object, entry: object}>} */
    this.cache = new Map();
  }

  /** All pattern names the mapping knows (sorted). */
  names() {
    return this.mapping.names();
  }

  /**
   * Resolve a pattern name to its imported factory + meta.
   * @param {string} name e.g. "nodes.llm"
   * @returns {Promise<{factory: Function, meta: object, entry: object}>}
   */
  async resolve(name) {
    const hit = this.cache.get(name);
    if (hit) return hit;

    const entry = this.mapping.get(name);
    if (!entry) {
      throw new RegistryError(`pattern '${name}' is not in the mapping — known patterns: ${previewNames(this.mapping)}`, { name });
    }

    const specifier = entryToImportSpecifier(entry);
    let mod;
    try {
      mod = await import(specifier);
    } catch (err) {
      throw new RegistryError(`pattern '${name}': import of '${entry.module}' failed: ${err.message}`, {
        name,
        module: entry.module,
        specifier,
      });
    }

    const factory = mod[entry.export];
    if (typeof factory !== "function") {
      throw new RegistryError(
        `pattern '${name}': module '${entry.module}' has no function export '${entry.export}' (exports: ${Object.keys(mod).join(", ")})`,
        { name, module: entry.module, export: entry.export },
      );
    }

    const meta = mod.meta ?? { name, category: entry.category, summary: "" };
    if (meta.name !== name) {
      throw new RegistryError(
        `pattern '${name}': module meta.name is '${meta.name}' — the mapping key and the atom's meta.name must agree`,
        { name, metaName: meta.name },
      );
    }
    if (meta.category !== entry.category) {
      throw new RegistryError(
        `pattern '${name}': module meta.category is '${meta.category}' but the mapping resolves category '${entry.category}'`,
        { name, metaCategory: meta.category, mappingCategory: entry.category },
      );
    }

    const binding = { factory, meta, entry };
    this.cache.set(name, binding);
    return binding;
  }

  /**
   * Import + verify EVERY mapped pattern (used by `langgraph-langchain-harness patterns --verify`,
   * the test suite, and docgen). Returns per-pattern results, never throws.
   */
  async verifyAll() {
    const results = [];
    for (const name of this.names()) {
      try {
        const { meta, entry } = await this.resolve(name);
        results.push({ name, ok: true, category: entry.category, module: entry.module, summary: meta.summary ?? "" });
      } catch (err) {
        results.push({ name, ok: false, error: err.message });
      }
    }
    return results;
  }

  /** Introspection payload for docs/API/UI: meta of every pattern, grouped. */
  async describe() {
    const byCategory = {};
    for (const name of this.names()) {
      const { meta, entry } = await this.resolve(name);
      (byCategory[entry.category] ??= []).push({
        name,
        module: entry.module,
        export: entry.export,
        summary: meta.summary ?? "",
        params: meta.params ?? null,
        origin: entry.origin,
      });
    }
    return byCategory;
  }
}

function previewNames(mapping) {
  const names = mapping.names();
  return names.slice(0, 8).join(", ") + (names.length > 8 ? `, … (${names.length} total)` : "");
}

/**
 * Convenience: build a Registry from a mapping file path (default mapping
 * when null). The usual entry point for backend/cli/tests.
 */
export async function createRegistry(mappingPath = null) {
  const { loadMapping } = await import("../mapping/mapping-loader.mjs");
  const mapping = await loadMapping(mappingPath);
  return new Registry(mapping);
}
