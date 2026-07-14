/**
 * dev/mock/main.tsx — the design mock's harness. Served at `http://localhost:5247/mock/`.
 *
 * This is the original four-route example harness for `organisms/RemediationReport` — the design
 * mock the report was derived from. It is preserved because the examples are the mock's reference
 * integrations: they encode its intended props, data shape, and callback surface, and its stories
 * and tests are written against the same fixtures.
 *
 * IT IS A SEPARATE PAGE, AND THAT IS THE WHOLE POINT (record 0058/A2). The mock is styled with
 * Tailwind; the report carries `src/report/report.css` and nothing else. Tailwind's preflight is a
 * global reset — load it on the report's page and it silently restyles headings, buttons, and
 * borders, which is one of the two reasons the dev server and the emitted `repo-remediation.html`
 * used to render differently. A separate document is the only isolation that actually holds: not a
 * route, not a scoped class, not a lazy import — those all end up in the same cascade.
 *
 *   /             the REPORT — the shipped tree over real session data (`dev/main.tsx`)
 *   /mock/        the MOCK   — this file. Not the report. Nothing here ships.
 *   /mock/empty   /mock/blocked   /mock/hidden — one address per example.
 *
 * BrowserRouter under a `/mock` basename, so every example is a real, linkable URL. That was not
 * safe before: vite's SPA fallback answers an unknown deep path like `/mock/empty` with the ROOT
 * `index.html`, which would serve the REPORT where a mock example was asked for — so this harness
 * hid its examples behind a hash router instead. The `harness:example-routes` middleware in
 * `vite.config.ts` now maps `/mock/*` to THIS document explicitly, which is what makes the path form
 * honest. If that middleware is ever removed, the hash router has to come back with it.
 */
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';

import './styles.css';

import { MOCK_BASE, MOCK_EXAMPLES, mockUrl } from '../routes';
import { HAVE_DATA, SESSIONS_ROOT } from './data';
import ExampleBlocked from './example-blocked';
import ExampleDefault from './example-default';
import ExampleEmpty from './example-empty';
import ExampleHidden from './example-hidden';

function DevNav() {
  const loc = useLocation();
  return (
    <nav className="fixed bottom-4 right-4 z-50 flex flex-col gap-1 rounded-lg bg-white p-2 shadow-lg ring-1 ring-slate-200">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Design mock — real data, older contract
      </div>
      {MOCK_EXAMPLES.map((e) => (
        <Link
          key={e.path}
          to={e.path}
          title={mockUrl(e.path)}
          className={
            'rounded px-2 py-1 text-xs ' +
            (loc.pathname === e.path ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100')
          }
        >
          {e.name}
          <span className={loc.pathname === e.path ? 'text-indigo-200' : 'text-slate-400'}>
            {' '}
            · {mockUrl(e.path)}
          </span>
        </Link>
      ))}
      {/* A plain <a>, not a <Link> — leaving the mock means leaving this DOCUMENT, which is what
          drops Tailwind's stylesheet before the report renders. */}
      <a
        href="/"
        className="mt-1 rounded border-t border-slate-100 px-2 pt-2 text-xs text-indigo-600 hover:underline"
      >
        ← the real report
      </a>
    </nav>
  );
}

/**
 * No emitted report on disk → no examples, on purpose.
 *
 * Every example is now a variant of a REAL session (record 0058). Falling back to
 * `fixtures.ts` here would quietly restore the very thing that let this harness drift away from the
 * shipped page: a dev surface rendering data no pipeline ever produced. The fixtures still exist —
 * for the mock's stories and unit tests, where invented data is the right tool.
 */
function NoData() {
  return (
    <div className="mx-auto my-16 max-w-2xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
      <h1 className="mb-3 text-base font-semibold text-slate-900">No report to draw the examples from</h1>
      <p className="mb-3">
        The examples render a real emitted session, adapted to the mock's contract. None was found under{' '}
        <code>{SESSIONS_ROOT}</code>.
      </p>
      <p className="mb-3">Run the flow to emit one, or point the dev server at an existing report:</p>
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-200">
        HARNESS_REPORT_HTML=../path/to/repo-remediation.html npm run dev
      </pre>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root is missing from dev/mock/index.html');

createRoot(rootEl).render(
  <BrowserRouter basename={MOCK_BASE}>
    <DevNav />
    {HAVE_DATA ? (
      <Routes>
        <Route path="/" element={<ExampleDefault />} />
        <Route path="/empty" element={<ExampleEmpty />} />
        <Route path="/blocked" element={<ExampleBlocked />} />
        <Route path="/hidden" element={<ExampleHidden />} />
      </Routes>
    ) : (
      <NoData />
    )}
  </BrowserRouter>,
);
