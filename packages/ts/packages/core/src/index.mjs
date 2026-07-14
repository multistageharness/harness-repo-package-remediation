// @harness/core public surface.
export const version = '0.0.0';

export * from './contracts.mjs';
export { ingest } from './pipeline.mjs';
export { diagnostic, createCollector } from './diagnostics.mjs';
export { normalize } from './normalize.mjs';
export { resolveReader, MIME_MAP } from './readers/registry.mjs';
export { csvReader } from './readers/csv.mjs';
export { xlsxReader } from './readers/xlsx.mjs';
