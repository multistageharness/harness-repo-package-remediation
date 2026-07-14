/**
 * Report.tsx — the report's composition root.
 *
 * THIS IS WHERE RECORD 0057/D3 LIVES. Read `navCss.ts` before changing anything here.
 *
 * The naive React shape for this screen is `const [openRepo, setOpenRepo] = useState(...)` and then
 * `{openRepo ? <RepoDetail/> : <Overview/>}` — render one branch, mount the other on click. That is
 * exactly what the design mock did, and it is wrong here for two independent reasons:
 *
 *   1. The prerendered markup would contain ONE view, with no way to reach any other until
 *      hydration runs. The generator's README commits to the opposite ("content-complete without
 *      JS"), and a JS-disabled reader would silently lose the whole report.
 *   2. `behavior.test.mjs` — the gate that proves record 0056's three defect fixes still hold —
 *      slices FIVE different repo cards out of the emitted HTML by index and asserts on each. With
 *      one-view-at-a-time, four of those five cards do not exist and the suite collapses.
 *
 * So: BOTH views and EVERY repo's detail are rendered into the markup, and visibility is decided by
 * hidden radio inputs + CSS `:checked ~` selectors. Prerendering gives you *a* view; rendering
 * everything is what gives you *the whole content*. Hydration then layers on the enhancements
 * (search, ecosystem filter, log filter, graph toggle, prompt expand, snapshot picker) — it never
 * owns navigation. Nothing here may move navigation into React state.
 */
import { useState } from 'react';

import './report.css';
import { EnvironmentBanner } from './EnvironmentBanner';
import { navCss } from './navCss';
import { Overview, topSev } from './Overview';
import { Rail } from './Rail';
import { RepoDetail } from './RepoDetail';
import { eco, sev } from './tokens';
import type { ReportData } from './types';

const ECO_FILTERS = ['all', 'node', 'java', 'python'];

/**
 * Flip a radio imperatively.
 *
 * The radios are UNCONTROLLED on purpose (`defaultChecked`) — CSS owns navigation, so React must
 * not take the value back under management. The enhancements that need to move the selection (the
 * overview's run-results row, which cannot be a `<label>` because a `<tr>` cannot) therefore poke
 * the DOM the same way the old vanilla client script did.
 */
function check(id: string) {
  const el = typeof document === 'undefined' ? null : (document.getElementById(id) as HTMLInputElement | null);
  if (el) el.checked = true;
}

export interface ReportProps {
  data: ReportData;
}

export function Report({ data }: ReportProps) {
  const { repos, totals, decided, passRate, rowsN, environment } = data;

  // Share of ALL remediation attempts. The five outcomes (fixed/broken/blocked/skipped/bug)
  // partition `totals.actions`, so these percentages are comparable WITH EACH OTHER — and
  // deliberately NOT with the pass rate beside them, whose denominator is `decided` (record 0033
  // keeps blocked and skipped out of it, so a down registry cannot depress the score). Two
  // denominators sit in this topbar; each chip states its own in its tooltip.
  const share = (n: number) => (totals.actions > 0 ? `${Math.round((n / totals.actions) * 100)}%` : '—');

  // Sidebar enhancements ONLY. These narrow what the sidebar shows; they never decide which repo is
  // open (a radio does) nor which view is up (a radio does).
  const [query, setQuery] = useState('');
  const [ecoFilter, setEcoFilter] = useState('all');

  if (repos.length === 0) {
    return (
      <main id="report">
        <header id="report-header">
          <h1 id="report-title">Repository remediation report</h1>
        </header>
        <section id="repos">
          <p className="empty">No repositories were ingested for this run.</p>
        </section>
      </main>
    );
  }

  const q = query.toLowerCase().trim();
  const matches = (i: number) => {
    const r = repos[i];
    const okEco = ecoFilter === 'all' || r.eco === ecoFilter;
    const pkgs = r.vulns.map((v) => v.pkg).join(' ').toLowerCase();
    const okQ = !q || r.key.toLowerCase().includes(q) || pkgs.includes(q);
    return okEco && okQ;
  };
  const shownCount = repos.filter((_, i) => matches(i)).length;

  const openRepo = (idx: number) => {
    check('rr-view-repositories');
    check(`rr-repo-${idx}`);
  };

  return (
    <>
      {/* Per-run navigation CSS. It enumerates each repo index and each tab, so it cannot live in
          the static stylesheet. Still pure CSS — the report navigates with the script blocked. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: generated CSS, no external text — navCss only interpolates loop indices. */}
      <style dangerouslySetInnerHTML={{ __html: navCss(repos.length) }} />

      <main id="report">
        {/* The radios are the FIRST children of #report so their `~` general-sibling selectors can
            reach the topbar labels and the views that follow. */}
        <input type="radio" name="rr-view" id="rr-view-overview" className="nav-radio" defaultChecked />
        <input type="radio" name="rr-view" id="rr-view-repositories" className="nav-radio" />
        {repos.map((r, i) => (
          <input
            key={r.id}
            type="radio"
            name="rr-repo"
            id={`rr-repo-${i}`}
            className="nav-radio"
            defaultChecked={i === 0}
          />
        ))}

        <header className="topbar">
          <div className="brand">
            <div className="brand-badge">R</div>
            <div>
              <h1 id="report-title">Repository remediation</h1>
              <p className="brand-sub">
                langgraph harness · {repos.length} repositories · {totals.vulns} advisories
              </p>
            </div>
          </div>
          <div className="topbar-right">
            <span
              className="chip chip-pass"
              data-testid="topbar-pass"
              title={`${totals.fixed} of ${decided} decided attempts fixed. Blocked and skipped are excluded from this denominator — it is a pass RATE, not a share of the run.`}
            >
              <span className="dot" />
              {passRate === null ? '—' : `${passRate}% pass`}
            </span>
            <span
              className={totals.blocked ? 'chip chip-blocked' : 'chip chip-zero'}
              data-testid="topbar-blocked"
              title={`${totals.blocked} of ${totals.actions} remediation attempts were blocked (environment or pre-existing) — ${share(totals.blocked)} of the run.`}
            >
              <span className="dot" />
              {totals.blocked} blocked · {share(totals.blocked)}
            </span>
            <span
              className={totals.skipped ? 'chip chip-skipped' : 'chip chip-zero'}
              data-testid="topbar-skipped"
              title={`${totals.skipped} of ${totals.actions} remediation attempts were skipped (benign no-op) — ${share(totals.skipped)} of the run.`}
            >
              <span className="dot" />
              {totals.skipped} skipped · {share(totals.skipped)}
            </span>
          </div>
          <nav className="seg" aria-label="view">
            <label className="seg-btn seg-overview" htmlFor="rr-view-overview">
              Overview
            </label>
            <label className="seg-btn seg-repositories" htmlFor="rr-view-repositories">
              Repositories <span className="seg-count">{repos.length}</span>
            </label>
          </nav>
        </header>

        {/* run-health-and-errors-log Epic 03: the environment verdict sits ABOVE both views, so a
            report read in isolation cannot be mistaken for a verdict on the code. Stamped data
            only (data.environment); renders nothing on a clean run. */}
        <EnvironmentBanner environment={environment} />

        <section className="view view-overview">
          <Overview
            repos={repos}
            totals={totals}
            decided={decided}
            passRate={passRate}
            rowsN={rowsN}
            onOpenRepo={openRepo}
          />
        </section>

        <section className="view view-repositories">
          <div className="repos-grid">
            <aside className="side">
              <div className="side-head">
                <input
                  className="side-search"
                  type="search"
                  placeholder="Search repos or packages"
                  aria-label="search repositories"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="side-ecos">
                  {ECO_FILTERS.map((e) => (
                    <button
                      type="button"
                      key={e}
                      className={e === ecoFilter ? 'eco-btn is-active' : 'eco-btn'}
                      data-eco-filter={e}
                      onClick={() => setEcoFilter(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              <nav className="side-list">
                {/* Sidebar entries are <label>s bound to the repo radios — selecting a repo is pure
                    CSS and works with the script blocked. The search/eco filter only hides them. */}
                {repos.map((r, i) => {
                  const pkgs = r.vulns.map((v) => v.pkg).join(' ').toLowerCase();
                  return (
                    <label
                      key={r.id}
                      className="repo-btn"
                      htmlFor={`rr-repo-${i}`}
                      data-idx={i}
                      data-repo-id={r.id}
                      data-eco={r.eco}
                      data-key={r.key.toLowerCase()}
                      data-pkgs={pkgs}
                      hidden={!matches(i)}
                    >
                      <span className="sev-dot" style={{ background: sev(topSev(r).sev).hex }} />
                      <span className="repo-btn-body">
                        <span className="repo-btn-key">{r.key}</span>
                        <span className="repo-btn-sub">
                          {eco(r.eco).label} · {r.vulns.length} advisor{r.vulns.length === 1 ? 'y' : 'ies'}
                        </span>
                      </span>
                    </label>
                  );
                })}
                <p className="side-empty" hidden={shownCount !== 0}>
                  No repository matches. Clear the filters.
                </p>
              </nav>

              <div className="side-foot">
                <span data-shown-count="">{shownCount}</span> of {repos.length}
              </div>
            </aside>

            {/* EVERY repo's detail and rail are rendered. CSS shows exactly one. */}
            <div className="detail-col">
              {repos.map((r, i) => (
                <RepoDetail key={r.id} repo={r} idx={i} />
              ))}
            </div>
            <aside className="rail-col">
              {repos.map((r, i) => (
                <Rail key={r.id} repo={r} idx={i} passRate={passRate} />
              ))}
            </aside>
          </div>
        </section>
      </main>
    </>
  );
}
