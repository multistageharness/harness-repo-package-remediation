/**
 * entry-server.tsx — the SSR half of the bundle (record 0057/A5).
 *
 * Vite compiles this, with React compiled IN, to a single self-contained `report-ssr.mjs` that the
 * generator imports by a RELATIVE path. That is the whole trick behind record 0057: React's ~325
 * dependencies are needed at BUILD time, never at RUNTIME. The generator keeps its zero-dependency
 * manifest, its tests keep running offline with no `node_modules`, and the flow never touches a
 * registry — which matters concretely on a machine whose local Verdaccio/devpi are frequently down
 * (record 0054). The dependencies reach the build; they never reach the generator.
 *
 * `renderReport` returns the markup for `<div id="root">`. It uses `renderToString`, which is
 * hydration-compatible — `hydrateRoot` on the client adopts this exact tree.
 */
// `react-dom/server.browser`, NOT `react-dom/server`. The Node build of react-dom/server pulls in
// `stream` and `util`, which would leave BARE specifiers in the emitted bundle — and the
// generator's `fixtures.test.mjs` asserts that no bare import exists anywhere it loads (every
// specifier must start with `node:`, `./`, or `../`). The browser build exposes the same
// `renderToString` with no Node dependencies at all, so the bundle comes out genuinely
// self-contained and would run just as happily in a worker as in Node.
import { renderToString } from 'react-dom/server.browser';

import { Report } from './Report';
import type { ReportData } from './types';

/** Prerender the whole report to a string. Pure — no clock, no I/O, no randomness. */
export function renderReport(data: ReportData): string {
  return renderToString(<Report data={data} />);
}

export type { ReportData } from './types';
