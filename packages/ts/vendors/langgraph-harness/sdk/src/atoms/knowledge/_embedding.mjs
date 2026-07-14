/**
 * atoms/knowledge/_embedding.mjs — deterministic offline embedder (private
 * helper). FNV-1a-hashed character trigrams into a fixed-dim vector,
 * L2-normalized — the excel-data-navigator lineage. No network, no model,
 * bit-identical across runs and platforms: the property the test suite and
 * the mock contract rely on.
 */

import { fnv1a } from "../../llm/provider.mjs";

export const DEFAULT_DIMS = 256;

/** Embed text into a normalized Float64Array of `dims`. */
export function embedText(text, dims = DEFAULT_DIMS) {
  const vector = new Float64Array(dims);
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return vector;
  // character trigrams + word unigrams — cheap hybrid that survives typos
  for (let i = 0; i < normalized.length - 2; i++) {
    const gram = normalized.slice(i, i + 3);
    vector[fnv1a(gram) % dims] += 1;
  }
  for (const word of normalized.split(" ")) {
    if (word) vector[fnv1a(`w:${word}`) % dims] += 2;
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) vector[i] /= norm;
  return vector;
}

/** Cosine similarity of two same-dim vectors (arrays or typed arrays). */
export function cosine(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // inputs are L2-normalized
}
