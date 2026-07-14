/**
 * dev/main.tsx — the dev harness. `http://localhost:5247` renders THE REPORT.
 *
 * This file used to mount `organisms/RemediationReport` over `SAMPLE_REPOS` — the design mock over
 * invented data — while the flow's `repo-remediation.html` renders `src/report/` over real
 * `ReportData`. Same package, two trees, two contracts: the dev server showed a report the reader
 * never gets. It now mounts the SHIPPED tree over the SHIPPED data, read out of an emitted report's
 * JSON island by `dev/sessions.mjs`. What you see here is what the page shows.
 *
 * TWO AXES, ONE DATASET. The picker crosses every emitted session with the variants in
 * `dev/variants.ts` (as-run · all-blocked · empty). The variants are pure transforms of the real
 * `ReportData`, with every total RECOMPUTED — so `all blocked` is the real repo set in an outage,
 * not a second dataset that happens to be red. No fixture is reachable from this page.
 *
 * THE TWO AXES ADDRESS DIFFERENTLY, AND DELIBERATELY. The example — what the report is showing — is
 * the PATH (`/blocked`, `/empty`; `/` is the default), so every example has an address you can link,
 * bookmark, and reload. The session — WHICH run supplied the data, a fact about this machine's disk
 * and not about the example — stays a query param (`?session=…`), because a path that names a
 * session id is not a URL anyone else can open. `dev/routes.ts` owns that grammar; `vite.config.ts`
 * reads the same constants so the server serves this document for exactly those paths.
 *
 * Deliberate details, each one load-bearing for parity with the emitted page:
 *
 *   - `#root` gets `<Report/>` AND NOTHING ELSE, exactly like the emitted page. The picker is
 *     portaled into a separate `#devbar` node so it can never perturb the report's layout, its CSS
 *     `:checked ~` navigation, or the markup a reader would inspect.
 *   - NO STYLESHEET IS IMPORTED HERE. `Report` imports `src/report/report.css`, which is the only CSS
 *     the emitted page carries. The old harness pulled in Tailwind, whose preflight silently restyled
 *     the report — that alone made the two renderings differ. Tailwind now lives only on `/mock/`'s
 *     own document (record 0058/A2).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { DATA_ROUTE, INITIAL, SESSIONS, SESSIONS_DIR } from 'virtual:report-sessions';

import { Report } from '../src/report/Report';
import type { ReportData } from '../src/report/types';
import { MOCK_BASE, reportPath, variantFromLocation } from './routes';
import { VARIANTS, variant } from './variants';

/** `?session=…` survives a reload, so the run you were looking at is the one that comes back. */
function param(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

/** The example this URL names — `dev/routes.ts` owns the grammar, including the legacy query form. */
function variantFromUrl(): string {
  return variantFromLocation(window.location.pathname, window.location.search);
}

/** An ordinary left-click we can turn into a pushState. Everything else (⌘/ctrl/shift, middle,
 *  right) must keep its browser meaning — that is the difference between a link and a button. */
function isPlainClick(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function DevBar({
  session,
  variantId,
  onSession,
  onVariant,
  loading,
}: {
  session: string;
  variantId: string;
  onSession: (id: string) => void;
  onVariant: (id: string) => void;
  loading: boolean;
}) {
  const host = document.getElementById('devbar');
  if (!host) return null;

  return createPortal(
    <div className="devbar">
      <div className="devbar-title">
        report data{loading ? ' · loading…' : ''}
        <span className="devbar-dim"> · {SESSIONS_DIR}</span>
      </div>
      {SESSIONS.map((s) => (
        <button
          type="button"
          key={s.id}
          className={s.id === session ? 'devbar-btn is-active' : 'devbar-btn'}
          onClick={() => onSession(s.id)}
        >
          {s.id.slice(0, 8)}
          <span className="devbar-dim">
            {' '}
            · {s.repos} repos · {s.vulns} advisories
          </span>
        </button>
      ))}

      <div className="devbar-title devbar-sep">example · same data, own url</div>
      {/* Anchors, not buttons: an example IS its URL now, so the control that selects it must be
          copyable, middle-clickable, and readable in the status bar. The click handler only
          intercepts a plain left-click, so ⌘-click still opens the example in a new tab. */}
      {VARIANTS.map((v) => (
        <a
          key={v.id}
          href={reportPath(v.id)}
          className={v.id === variantId ? 'devbar-btn is-active' : 'devbar-btn'}
          title={`${reportPath(v.id)} — ${v.note}`}
          onClick={(e) => {
            if (!isPlainClick(e)) return;
            e.preventDefault();
            onVariant(v.id);
          }}
        >
          {v.label}
          <span className="devbar-dim"> · {reportPath(v.id)}</span>
        </a>
      ))}

      {/* A full document navigation, NOT a client-side route: the mock's page is what loads
          Tailwind, and this page must never have it in its cascade (record 0058/A2). */}
      <a className="devbar-link" href={`${MOCK_BASE}/`}>
        design mock ↗<span className="devbar-dim"> · same data, older contract</span>
      </a>
    </div>,
    host,
  );
}

/** No report on disk yet — say what to run rather than render a blank page or invent one. */
function NoSessions() {
  return (
    <div className="devnote">
      <h1>No report found</h1>
      <p>
        The harness looked for <code>&lt;session-id&gt;/repo-remediation.html</code> under{' '}
        <code>{SESSIONS_DIR}</code> and found none.
      </p>
      <p>Run the flow to emit one, or point the dev server at an existing report:</p>
      <pre>HARNESS_REPORT_HTML=../path/to/repo-remediation.html npm run dev</pre>
      <p>
        A directory of sessions works too: <code>HARNESS_SESSIONS_DIR=&lt;dir&gt;</code>. There is no
        fixture fallback on purpose — a fixture that looks like a report is how this harness drifted
        away from the shipped page before.
      </p>
    </div>
  );
}

/** The address of one example on this machine: its path, carrying the session query along. */
function urlFor(variantId: string): string {
  const url = new URL(window.location.href);
  url.pathname = reportPath(variantId);
  // The example is the path now; a leftover `?variant=` would be a second, contradictable answer.
  url.searchParams.delete('variant');
  return `${url.pathname}${url.search}`;
}

function DevApp() {
  const [session, setSession] = useState(param('session') ?? SESSIONS[0]?.id ?? '');
  const [variantId, setVariantId] = useState(variantFromUrl);
  // The RAW session data. The variant is applied at render, so switching it costs no fetch.
  const [raw, setRaw] = useState<ReportData | null>(session === SESSIONS[0]?.id ? INITIAL : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Examples are history entries, so back/forward walks between them like any other pair of pages.
  useEffect(() => {
    const onPop = () => setVariantId(variantFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (raw || !session) return;
    let live = true;
    setLoading(true);
    fetch(`${DATA_ROUTE}${encodeURIComponent(session)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((d: ReportData) => live && setRaw(d))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [session, raw]);

  /** Which run supplied the data — a fact about this disk, so it stays in the query, and REPLACES
   *  rather than pushes: switching datasets is not a place you navigate back to. */
  const pickSession = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('session', id);
    window.history.replaceState(null, '', url);
    setError(null);
    setSession(id);
    setRaw(null);
  };
  /** Which example you are looking at — that IS the address, so it PUSHES a history entry. */
  const pickVariant = (id: string) => {
    window.history.pushState(null, '', urlFor(id));
    setVariantId(id);
  };

  const bar = (
    <DevBar
      session={session}
      variantId={variantId}
      onSession={pickSession}
      onVariant={pickVariant}
      loading={loading}
    />
  );

  if (SESSIONS.length === 0) {
    return (
      <>
        {bar}
        <NoSessions />
      </>
    );
  }
  if (error) {
    return (
      <>
        {bar}
        <div className="devnote">
          <h1>Could not load {session}</h1>
          <pre>{error}</pre>
        </div>
      </>
    );
  }
  if (!raw) return <>{bar}</>;

  return (
    <>
      {bar}
      {/* `key` forces a fresh mount per variant: the report's navigation lives in UNCONTROLLED
          radios (`defaultChecked`), and React would otherwise carry the old selection — and the old
          repo index — across a dataset with a different number of repos. */}
      <Report key={variantId} data={variant(variantId).apply(raw)} />
    </>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root is missing from dev/index.html');

// Canonicalize before the first paint: `/`, an unknown path, and a legacy `?variant=` link all
// become the example's own address (`/as-run`, `/blocked`, …). `replaceState`, not `pushState` —
// arriving somewhere is not a navigation, and a back button that undoes a rewrite is a trap.
window.history.replaceState(null, '', urlFor(variantFromUrl()));

createRoot(rootEl).render(<DevApp />);
