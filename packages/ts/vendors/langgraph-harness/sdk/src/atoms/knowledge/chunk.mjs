/**
 * knowledge.chunk — split loaded documents into overlapping character chunks
 * [{id, doc_id, text}], paragraph-boundary-aware. Deterministic.
 */

export const meta = {
  name: "knowledge.chunk",
  category: "knowledge",
  summary: "Split [{id, text}] docs into overlapping chunks [{id, doc_id, text}].",
  params: {
    type: "object",
    required: ["from", "into"],
    properties: {
      from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      size: { type: "integer", minimum: 50, maximum: 20000 },
      overlap: { type: "integer", minimum: 0, maximum: 5000 },
    },
  },
  returns: "node",
};

export function chunkDocuments(text, size, overlap) {
  const paragraphs = text.split(/\r?\n\r?\n+/);
  const chunks = [];
  let buffer = "";
  for (const para of paragraphs) {
    if (buffer.length + para.length + 2 > size && buffer.length > 0) {
      chunks.push(buffer.trim());
      buffer = overlap > 0 ? buffer.slice(-overlap) + "\n\n" : "";
    }
    buffer += (buffer ? "\n\n" : "") + para;
    // hard-split any single paragraph longer than size
    while (buffer.length > size) {
      chunks.push(buffer.slice(0, size).trim());
      buffer = buffer.slice(size - overlap);
    }
  }
  if (buffer.trim().length > 0) chunks.push(buffer.trim());
  return chunks;
}

export function chunk(params, ctx) {
  const size = params.size ?? 800;
  const overlap = params.overlap ?? 100;
  return async (state) => {
    const docs = state[params.from];
    if (!Array.isArray(docs)) throw new Error(`knowledge.chunk: channel '${params.from}' is not a document array`);
    const chunks = [];
    for (const doc of docs) {
      const pieces = chunkDocuments(doc.text ?? "", size, overlap);
      pieces.forEach((text, i) => {
        chunks.push({ id: `${doc.id}#${i}`, doc_id: doc.id, text });
      });
    }
    return { [params.into]: chunks };
  };
}
