/**
 * knowledge.vectorStore — build a named in-memory cosine vector store from
 * embedded chunks; optionally persist an atomic JSON snapshot so later runs
 * (and knowledge.retrieve in other flows) can reload it without re-indexing.
 *
 * Stores live in ctx.stores (shared across the nodes of one compiled flow).
 */

import { isAbsolute, resolve } from "node:path";

import { writeFileAtomic } from "../../services/atomic-fs.mjs";

export const meta = {
  name: "knowledge.vectorStore",
  category: "knowledge",
  summary: "Build a named in-memory cosine store from embedded chunks (+ JSON snapshot).",
  params: {
    type: "object",
    required: ["from", "store", "into"],
    properties: {
      from: { type: "string", minLength: 1 },
      store: { type: "string", minLength: 1 },
      persist_path: { type: "string" },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function vectorStore(params, ctx) {
  return async (state) => {
    const chunks = state[params.from];
    if (!Array.isArray(chunks)) throw new Error(`knowledge.vectorStore: channel '${params.from}' is not a chunk array`);
    const missing = chunks.filter((c) => !Array.isArray(c.vector));
    if (missing.length > 0) {
      throw new Error(`knowledge.vectorStore: ${missing.length} chunks have no vector — run knowledge.embed first`);
    }
    const store = { name: params.store, dims: chunks[0]?.vector.length ?? 0, chunks };
    ctx.stores.set(params.store, store);

    let persisted = null;
    if (params.persist_path) {
      persisted = isAbsolute(params.persist_path) ? params.persist_path : resolve(ctx.options.baseDir, params.persist_path);
      await writeFileAtomic(persisted, JSON.stringify(store));
    }
    return { [params.into]: { store: params.store, size: chunks.length, dims: store.dims, persisted } };
  };
}
