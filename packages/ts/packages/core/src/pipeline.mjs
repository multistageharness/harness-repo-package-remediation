// The core public ingest(): ties reader resolution, reading, normalization, and diagnostics
// together into a single result. Never throws for expected failures — reports diagnostics.
import { resolveReader } from './readers/registry.mjs';
import { normalize } from './normalize.mjs';
import { createCollector, diagnostic } from './diagnostics.mjs';
import { CODES } from './contracts.mjs';

/**
 * @param {import('./contracts.mjs').IngestSource} source
 * @param {import('./contracts.mjs').IngestOptions} [options]
 * @returns {Promise<import('./contracts.mjs').IngestResult>}
 */
export async function ingest(source, options = {}) {
  const diagnostics = createCollector();
  const label = source?.filename || source?.path || null;

  let reader;
  try {
    reader = resolveReader(source, options);
  } catch (e) {
    diagnostics.add(e.diagnostic ?? unknownFailure(e));
    return { rows: [], diagnostics: diagnostics.all(), meta: { source: label, readerId: null, rowCount: 0 } };
  }

  let raw;
  try {
    raw = await reader.read(source, options);
  } catch (e) {
    diagnostics.add(
      diagnostic({
        severity: 'error',
        code: CODES.READ_FAILED,
        message: `Reader "${reader.id}" failed to read source: ${e.message}`,
      }),
    );
    return { rows: [], diagnostics: diagnostics.all(), meta: { source: label, readerId: reader.id, rowCount: 0 } };
  }

  const { rows } = normalize(raw, options, diagnostics);
  return {
    rows,
    diagnostics: diagnostics.all(),
    meta: { source: label, readerId: reader.id, rowCount: rows.length },
  };
}

function unknownFailure(e) {
  return diagnostic({ severity: 'error', code: CODES.UNKNOWN_FORMAT, message: e.message });
}
