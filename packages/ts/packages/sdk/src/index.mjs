// @harness/sdk public surface: a thin, ergonomic facade over @harness/core.
export const version = '0.0.0';

export { ingest } from './ingest.mjs';
export { ingestStream } from './stream.mjs';
export { normalizeOptions } from './options.mjs';

// Re-export core contracts and helpers so SDK consumers have a single import surface.
// The explicit `ingest` above shadows core's `ingest` from this star re-export.
export * from '@harness/core';
