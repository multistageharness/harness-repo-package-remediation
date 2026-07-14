/**
 * vite.ssr.config.ts — the SSR half of the report bundle (record 0057/A5).
 *
 * Emits `dist/ssr/report-ssr.mjs`: a single self-contained ES module exporting
 * `renderReport(data) → string`, with REACT COMPILED IN (`ssr.noExternal: true`). That last part is
 * the entire point. The generator imports this file by a RELATIVE path, so:
 *
 *   - its `package.json` keeps declaring ZERO dependencies (`fixtures.test.mjs` asserts it),
 *   - its `src/` keeps containing NO bare imports (`fixtures.test.mjs` asserts that too),
 *   - its tests keep running offline with no `node_modules`, and
 *   - the flow never touches a registry to render a report (record 0054).
 *
 * React's dependencies reach the BUILD. They never reach the RUNTIME.
 *
 * `minify: false` on purpose — this is a committed artifact that humans will read diffs of, and
 * nothing in Node cares about its size.
 *
 * NOTE the deliberate absence of `root: 'dev'` (which `vite.config.ts` sets for the dev server).
 * Inheriting it would bundle the dev harness app instead of the library.
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Vite does NOT define this for SSR builds, so without it the committed bundle ships DEV-mode
  // React: every dev warning, every `getComponentNameFromType` path, and a runtime read of
  // `process.env.NODE_ENV` on a bundle that is supposed to be self-contained. Pinning it lets
  // Rollup dead-code-eliminate the whole development branch.
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    ssr: true,
    outDir: 'dist/ssr',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'src/report/entry-server.tsx',
      formats: ['es'],
      fileName: () => 'report-ssr.mjs',
    },
    rollupOptions: {
      // `build.ssr` ignores `lib.fileName`, so pin the entry name here or the artifact lands as
      // `entry-server.js` and the committed-bundle paths drift from the config that produced them.
      output: { entryFileNames: 'report-ssr.mjs' },
    },
  },
  ssr: {
    // Bundle EVERYTHING. The default externalizes dependencies, which would leave bare
    // `import 'react'` specifiers in the output and make the generator need node_modules.
    noExternal: true,
  },
});
