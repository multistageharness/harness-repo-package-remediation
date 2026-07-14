// Shared ingestion vocabulary. Expressed as JSDoc typedefs — no runtime cost, full
// editor/reviewer value. The only runtime export is the frozen CODES catalog.

/**
 * @typedef {Object} IngestSource
 * @property {string} [path] Filesystem path to read from.
 * @property {Uint8Array} [buffer] In-memory bytes to read from.
 * @property {ReadableStream} [stream] Streaming source (reserved; not yet consumed).
 * @property {string} [filename] Original filename used for format detection.
 */

/**
 * @typedef {Object} IngestOptions
 * @property {'auto'|'csv'|'xlsx'} [format] Force a reader; 'auto' detects from the source.
 * @property {number} [limit] Maximum number of rows to return.
 * @property {boolean} [headers] Whether the first row is a header (default true).
 */

/**
 * A single normalized record, keyed by field name.
 * @typedef {Object<string, unknown>} Row
 */

/**
 * @typedef {Object} Diagnostic
 * @property {'info'|'warning'|'error'} severity
 * @property {string} code One of the CODES catalog values.
 * @property {string} message Human-readable description.
 * @property {object} [at] Optional location/context ({ row, column, ... }).
 */

/**
 * @typedef {Object} IngestResult
 * @property {Row[]} rows
 * @property {Diagnostic[]} diagnostics
 * @property {object} meta
 */

/**
 * @typedef {Object} Reader
 * @property {string} id Stable reader identifier ('csv' | 'xlsx').
 * @property {(source: IngestSource) => boolean} canRead
 * @property {(source: IngestSource, opts: IngestOptions) => Promise<{header: string[], records: unknown[][]}>} read
 */

/**
 * Diagnostic code catalog. Frozen so it can be relied on as a stable enum.
 */
export const CODES = Object.freeze({
  UNKNOWN_FORMAT: 'UNKNOWN_FORMAT',
  EMPTY_SHEET: 'EMPTY_SHEET',
  HEADER_FIXED: 'HEADER_FIXED',
  READ_FAILED: 'READ_FAILED',
});
