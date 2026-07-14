// Async-iterator streaming surface. Buffered under the hood for now; the surface is locked
// so callers can adopt `for await` today and gain true streaming later without a break.
import { ingest } from './ingest.mjs';

/**
 * @param {string | import('@harness/core').IngestSource} source
 * @param {import('@harness/core').IngestOptions} [options]
 * @returns {AsyncGenerator<import('@harness/core').Row>}
 */
export async function* ingestStream(source, options = {}) {
  const { rows } = await ingest(source, options);
  for (const row of rows) {
    yield row;
  }
}
