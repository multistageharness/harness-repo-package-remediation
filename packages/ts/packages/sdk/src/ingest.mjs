// Stable SDK ingest() facade over @harness/core. Owns option normalization and limit
// truncation at the boundary.
import { ingest as coreIngest } from '@harness/core';
import { normalizeOptions } from './options.mjs';

/**
 * @param {string | import('@harness/core').IngestSource} source A file path or a source object.
 * @param {import('@harness/core').IngestOptions} [options]
 * @returns {Promise<import('@harness/core').IngestResult>}
 */
export async function ingest(source, options = {}) {
  const opts = normalizeOptions(options);
  const src = typeof source === 'string' ? { path: source, filename: source } : source;

  const result = await coreIngest(src, opts);

  if (Number.isFinite(opts.limit) && result.rows.length > opts.limit) {
    const rows = result.rows.slice(0, opts.limit);
    return { ...result, rows, meta: { ...result.meta, rowCount: rows.length } };
  }
  return result;
}
