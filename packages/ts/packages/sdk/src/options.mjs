// The SDK owns option defaults, validation, and boundary-level limit truncation.

const FORMATS = new Set(['auto', 'csv', 'xlsx']);

/**
 * Validate and fill option defaults.
 * @param {import('@harness/core').IngestOptions} [opts]
 * @returns {{ format: 'auto'|'csv'|'xlsx', limit: number, headers: boolean }}
 */
export function normalizeOptions(opts = {}) {
  const { format = 'auto', limit = Infinity, headers = true } = opts;

  if (!FORMATS.has(format)) {
    throw new TypeError(`Invalid format "${format}"; expected one of auto, csv, xlsx.`);
  }

  const limitOk = limit === Infinity || (typeof limit === 'number' && Number.isFinite(limit) && limit > 0);
  if (!limitOk) {
    throw new TypeError(`Invalid limit "${limit}"; expected a positive number or Infinity.`);
  }

  if (typeof headers !== 'boolean') {
    throw new TypeError(`Invalid headers "${headers}"; expected a boolean.`);
  }

  return { format, limit, headers };
}
