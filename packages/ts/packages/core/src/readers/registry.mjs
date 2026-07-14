// Reader registry + format detection: pick a reader from a source without the caller naming one.
import { csvReader } from './csv.mjs';
import { xlsxReader } from './xlsx.mjs';
import { diagnostic } from '../diagnostics.mjs';
import { CODES } from '../contracts.mjs';

const readers = [csvReader, xlsxReader];
const byId = new Map(readers.map((r) => [r.id, r]));

/** MIME types mapped to reader ids (reserved for future content-type based detection). */
export const MIME_MAP = Object.freeze({
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
});

/**
 * Resolve the reader for a source. An explicit `opts.format` overrides detection.
 * @param {import('../contracts.mjs').IngestSource} source
 * @param {import('../contracts.mjs').IngestOptions} [opts]
 * @returns {import('../contracts.mjs').Reader}
 */
export function resolveReader(source, opts = {}) {
  if (opts.format && opts.format !== 'auto') {
    const forced = byId.get(opts.format);
    if (forced) return forced;
  }

  const detected = readers.find((r) => r.canRead(source));
  if (detected) return detected;

  const name = source.filename || source.path || '(unknown)';
  const err = new Error(`Could not determine a reader for source: ${name}`);
  err.diagnostic = diagnostic({
    severity: 'error',
    code: CODES.UNKNOWN_FORMAT,
    message: `Unknown or unsupported format for "${name}".`,
  });
  throw err;
}
