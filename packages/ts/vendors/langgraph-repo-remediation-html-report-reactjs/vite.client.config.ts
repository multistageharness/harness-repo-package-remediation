/**
 * vite.client.config.ts — the browser half of the report bundle (record 0057/A5).
 *
 * Emits two artifacts:
 *   - `dist/client/report-client.js` — a self-contained IIFE (React compiled in) that reads the
 *     JSON data island and hydrates `#root`. The generator inlines it in a `<script>` tag.
 *   - `dist/client/report.css` — the extracted stylesheet. The generator inlines it in `<style>`.
 *
 * BOTH MUST BE SELF-CONTAINED, and a test enforces it rather than trusting it:
 * `render.test.mjs`'s offline assertion —
 *   `assert.doesNotMatch(doc, /<link[^>]+href=|<script[^>]+src=|@import|url\(http/i)`
 * — fails on any external reference. An inlined bundle satisfies it; a Vite build that emitted an
 * external `assets/index-*.js` would not. That assertion is what makes "embedded in a single HTML
 * page" enforceable instead of aspirational, so `cssCodeSplit` is off and the IIFE format is not
 * negotiable (an ES module would need `type="module"` and a network-fetchable URL).
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Without this, React's CJS entry (`if (process.env.NODE_ENV === 'production') … else …`) has no
  // statically-known branch, so Rollup bundles BOTH the production and the development build of
  // React into the artifact — ~500 kB where ~150 kB will do, with dev warnings shipped to readers.
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    cssCodeSplit: false,
    // The report is read from a `file://` path as often as over http — keep it ES2019-plain.
    target: 'es2019',
    lib: {
      entry: 'src/report/entry-client.tsx',
      formats: ['iife'],
      name: 'RepoRemediationReport',
      fileName: () => 'report-client.js',
    },
    rollupOptions: {
      output: {
        // One predictable name, no content hash — the generator reads these by path, and a hashed
        // filename would make the committed bundle churn on every build.
        assetFileNames: 'report.css',
      },
    },
  },
});
