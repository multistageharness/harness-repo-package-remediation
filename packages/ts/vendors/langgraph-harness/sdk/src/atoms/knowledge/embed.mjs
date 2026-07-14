/**
 * knowledge.embed — attach a deterministic embedding vector to each chunk
 * ({... vector: number[]}). FNV-trigram hashing embedder: offline,
 * dependency-free, bit-stable (the corpus's excel-data-navigator lane).
 */

import { DEFAULT_DIMS, embedText } from "./_embedding.mjs";

export const meta = {
  name: "knowledge.embed",
  category: "knowledge",
  summary: "Attach deterministic hash-trigram embedding vectors to chunks.",
  params: {
    type: "object",
    required: ["from", "into"],
    properties: {
      from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      dims: { type: "integer", minimum: 16, maximum: 4096 },
    },
  },
  returns: "node",
};

export function embed(params) {
  const dims = params.dims ?? DEFAULT_DIMS;
  return async (state) => {
    const chunks = state[params.from];
    if (!Array.isArray(chunks)) throw new Error(`knowledge.embed: channel '${params.from}' is not a chunk array`);
    const embedded = chunks.map((c) => ({ ...c, vector: Array.from(embedText(c.text ?? "", dims)) }));
    return { [params.into]: embedded };
  };
}
