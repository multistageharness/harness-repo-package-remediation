/**
 * vite.config.ts — the dev server (`http://localhost:5247`) and the vitest run.
 *
 * The dev server renders THE SHIPPED REPORT: `src/report/`, the same tree `entry-server.tsx`
 * prerenders into every `repo-remediation.html`, over the same `ReportData` those pages carry in
 * their JSON island. It is not a preview of the report and not a mock of it — same components,
 * same data, same stylesheet. If the two ever diverge again, `npm run check:report -- <path>`
 * (`scripts/check-report.mjs`) says so.
 *
 * Two rules keep that parity honest, and both are easy to break by accident:
 *
 *   - NO TAILWIND. The emitted page inlines `src/report/report.css` and nothing else, so a global
 *     Tailwind import here — preflight alone restyles headings, borders, and buttons — would make
 *     the dev server render something the reader will never see. `dev/` therefore loads no
 *     stylesheet of its own; the report brings its own CSS.
 *   - `#root` HOLDS ONLY THE REPORT. The dev picker mounts into its own `#devbar` node, exactly as
 *     the emitted page keeps everything but the report out of `#root`.
 *
 * `reportData()` below is the seam that feeds it — see `dev/sessions.mjs`.
 */
import react from '@vitejs/plugin-react';
import { type Plugin, type ViteDevServer, defineConfig } from 'vite';

import { MOCK_BASE, REPORT_PATHS } from './dev/routes';
import { discoverSessions, sessionsDir } from './dev/sessions.mjs';

const VIRTUAL_ID = 'virtual:report-sessions';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const DATA_ROUTE = '/__report/data/';

/**
 * Serve the right DOCUMENT for an example's URL.
 *
 * Every example is addressable by path (`dev/routes.ts`), and a path only works if a reload of it
 * lands on the page that knows what it means. Vite's own SPA fallback answers every unmatched HTML
 * request with the ROOT `index.html`, which for a deep mock path like `/mock/blocked` would quietly
 * serve the REPORT where the mock was asked for — the exact confusion this package exists to stop
 * having, and the reason the mock used to hide behind a hash router.
 *
 * So the mapping is explicit: the report's own paths render `dev/index.html`, anything under
 * `/mock/` renders `dev/mock/index.html`, and each page's client router takes it from there. The
 * paths come from the same module the client imports, so the two cannot drift.
 *
 * Only HTML navigations are rewritten. A module or asset request under `/mock/` (`main.tsx`,
 * `styles.css`) does not accept `text/html` and must be left alone for vite to serve.
 */
function exampleRoutes(): Plugin {
  return {
    name: 'harness:example-routes',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, _res, next) => {
        if (!req.headers.accept?.includes('text/html')) return next();
        const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';

        if (path === MOCK_BASE || path.startsWith(`${MOCK_BASE}/`)) {
          req.url = `${MOCK_BASE}/index.html`;
        } else if (REPORT_PATHS.includes(path)) {
          req.url = '/index.html';
        }
        next();
      });
    },
  };
}

/**
 * Serve real `ReportData` — read out of the reports the flow actually emitted — to the dev harness.
 *
 * Exposes a virtual module carrying the session list plus the default session's data, so the first
 * paint is a real report with no fetch waterfall, and an endpoint the picker hits when you switch
 * sessions. Both re-read from disk, so re-running the flow needs only a page reload.
 */
function reportData(): Plugin {
  return {
    name: 'harness:report-data',

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },

    load(id) {
      if (id !== RESOLVED_ID) return null;
      const sessions = discoverSessions();
      // Metadata for the picker; the heavy `data` payload rides along for the default session only.
      const index = sessions.map(({ id: sid, file, mtime, repos, vulns }) => ({ id: sid, file, mtime, repos, vulns }));
      return [
        `export const SESSIONS = ${JSON.stringify(index)};`,
        `export const SESSIONS_DIR = ${JSON.stringify(sessionsDir)};`,
        `export const INITIAL = ${sessions.length ? JSON.stringify(sessions[0].data) : 'null'};`,
        `export const DATA_ROUTE = ${JSON.stringify(DATA_ROUTE)};`,
      ].join('\n');
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(DATA_ROUTE)) return next();
        const id = decodeURIComponent(req.url.slice(DATA_ROUTE.length).replace(/\.json$/, ''));
        const session = discoverSessions().find((s) => s.id === id);
        res.setHeader('content-type', 'application/json');
        if (!session) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: `no session ${id} under ${sessionsDir}` }));
          return;
        }
        res.end(JSON.stringify(session.data));
      });

      // A flow run that rewrites a report reloads the browser. Watch the report FILES — watching the
      // session directory would drag every cloned repo under `.harness/<id>/repos/` into chokidar.
      server.watcher.add(`${sessionsDir}/*/repo-remediation.html`);
      const reload = (file: string) => {
        if (!file.endsWith('repo-remediation.html')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', reload);
      server.watcher.on('add', reload);
    },
  };
}

export default defineConfig({
  root: 'dev',
  plugins: [react(), reportData(), exampleRoutes()],
  server: { port: 5247, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    // `dev/` is tested too: the URL grammar in `dev/routes.ts` is a contract with every link anyone
    // wrote down, and it breaks silently — the page still renders, just not the example asked for.
    include: ['../src/**/*.test.{ts,tsx}', './**/*.test.{ts,tsx}'],
  },
});
