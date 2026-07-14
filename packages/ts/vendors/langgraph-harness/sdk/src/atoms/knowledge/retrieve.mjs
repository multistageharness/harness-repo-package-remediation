/**
 * knowledge.retrieve — embed the query channel and cosine-rank the named
 * store's chunks; write the top-k [{id, doc_id, text, score}] into a channel.
 * Falls back to a persisted snapshot when the store isn't in memory (so
 * retrieval-only flows don't re-index).
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { cosine, embedText } from "./_embedding.mjs";

export const meta = {
  name: "knowledge.retrieve",
  category: "knowledge",
  summary: "Cosine top-k retrieval from a named store into a channel.",
  params: {
    type: "object",
    required: ["store", "query_from", "into"],
    properties: {
      store: { type: "string", minLength: 1 },
      snapshot_path: { type: "string" },
      query_from: { type: "string", minLength: 1 },
      top_k: { type: "integer", minimum: 1, maximum: 100 },
      min_score: { type: "number", minimum: 0, maximum: 1 },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function retrieve(params, ctx) {
  const topK = params.top_k ?? 3;
  return async (state) => {
    let store = ctx.stores.get(params.store);
    if (!store && params.snapshot_path) {
      const abs = isAbsolute(params.snapshot_path) ? params.snapshot_path : resolve(ctx.options.baseDir, params.snapshot_path);
      try {
        store = JSON.parse(await readFile(abs, "utf8"));
        ctx.stores.set(params.store, store);
      } catch (err) {
        throw new Error(`knowledge.retrieve: cannot load snapshot '${params.snapshot_path}': ${err.message}`);
      }
    }
    if (!store) {
      throw new Error(`knowledge.retrieve: store '${params.store}' not built in this flow and no snapshot_path given`);
    }
    const query = state[params.query_from];
    if (typeof query !== "string" || query.length === 0) {
      throw new Error(`knowledge.retrieve: query channel '${params.query_from}' is empty`);
    }
    const qv = embedText(query, store.dims);
    const scored = store.chunks
      .map((c) => ({ id: c.id, doc_id: c.doc_id, text: c.text, score: Number(cosine(qv, c.vector).toFixed(6)) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, topK)
      .filter((c) => c.score >= (params.min_score ?? 0));
    return { [params.into]: scored };
  };
}
