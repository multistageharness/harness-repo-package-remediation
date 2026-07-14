/**
 * Report.test.tsx — the switchover's two load-bearing gates, from the React side (record 0057).
 *
 * 1. HYDRATION MUST NOT MISMATCH. This is the one failure mode the generator's tests structurally
 *    cannot see: they assert on the prerendered STRING, and a hydration mismatch only happens in a
 *    browser. Worse, React SILENCES mismatch warnings in production builds — and the committed
 *    bundle is a production build — so a mismatch would ship as a subtly wrong page with a green
 *    CI. Here it is loud: we prerender exactly as `renderReport` does, hydrate the result, and fail
 *    on any React error/warning.
 *
 * 2. THE NO-JS INVARIANT (record 0057/D3). Every view, every repo detail, and every tab panel must
 *    be present in the PRERENDERED markup, with visibility driven by CSS radios rather than React
 *    state. If someone "simplifies" the tree back to `{open ? <Detail/> : <Overview/>}`, this fails
 *    — which is the point. That refactor would look harmless and would silently cost the report its
 *    JS-disabled readability AND break the generator's `behavior.test.mjs`.
 *
 * The fixture is real `ReportData` — the exact output of the generator's `buildReportData` over its
 * adversarial (deliberately NON-green) channels, so it exercises a skipped remediation, a broken
 * repo, a rule-injected action, a blocked repo, and an `n/a` build. Regenerate it from the
 * generator if the contract changes; a drift here means the two halves disagree about the shape.
 */
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server.browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fixture from './__fixtures__/report-data.json';
import { navCss } from './navCss';
import { Report } from './Report';
import type { ReportData } from './types';

const data = fixture as unknown as ReportData;

const prerender = () => renderToString(<Report data={data} />);

describe('prerendered markup (the no-JS invariant — record 0057/D3)', () => {
  const html = prerender();

  it('renders EVERY repo detail card, not just the open one', () => {
    const cards = html.match(/data-testid="repo-card"/g) ?? [];
    expect(cards).toHaveLength(data.repos.length);
    expect(cards.length).toBeGreaterThan(1);
  });

  it('renders BOTH views', () => {
    expect(html).toContain('<section class="view view-overview">');
    expect(html).toContain('<section class="view view-repositories">');
    // Dependencies is no longer a top-level view — the package inventory is a tab inside each
    // repo's card. A leftover section here would be a second, run-wide copy of it.
    expect(html).not.toContain('view-dependencies');
    expect(html).not.toContain('seg-dependencies');
  });

  it('renders every tab panel of every repo (4 per repo)', () => {
    const panels = html.match(/class="tab-panel"/g) ?? [];
    expect(panels).toHaveLength(data.repos.length * 4);
    expect(html).toContain('data-tab="meta"'); // the tab the design mock never had
    expect(html).toContain('data-tab="deps"'); // the package inventory, now per repo
    // The per-repo `graph` tab (an SVG of the resolved tree) is GONE — the inventory table took its
    // place. It must not linger in the markup: `navCss` emits no selector that could ever display
    // it, so a panel left behind here would be permanently invisible and nothing else would fail.
    expect(html).not.toContain('data-tab="graph"');
  });

  it("gives every repo its OWN inventory — the tab is not one run-wide table repeated", () => {
    // Each card renders its own repo's packages. The regression this catches is a `deps` panel wired
    // to a run-wide list, which would show every repo the same table and quietly re-create the
    // top-level view inside each card.
    expect(html.match(/data-testid="dep-inventory"/g) ?? []).toHaveLength(data.repos.length);
    // `minimist` is in skipped-rem's graph and no other repo's, so it appears exactly once.
    expect(html.match(/data-name="minimist"/g) ?? []).toHaveLength(1);
    // …and the repo with no graph renders the not-measured note instead of an empty table.
    expect(html).toContain('data-testid="dep-empty"');
  });

  /**
   * THE TAB REGISTRY LOCKSTEP — the trap this file exists to close.
   *
   * `RepoDetail.TABS` decides which panels are RENDERED; `navCss.TABS` decides which can ever be
   * SHOWN. They are two separate lists, and when they drift nothing throws, no test fails, and the
   * panel is simply invisible forever. Both the `graph` removal and the `deps` addition had to touch
   * both lists. So rather than trusting a comment to keep them aligned, assert it: every panel in
   * the markup must have a selector in the stylesheet that can display it, and vice versa.
   */
  it('every rendered tab panel has a CSS selector that can display it', () => {
    const rendered = [...new Set([...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]))].sort();
    const css = navCss(data.repos.length);
    const selectable = [...new Set([...css.matchAll(/\.tab-panel\[data-tab="([^"]+)"\]/g)].map((m) => m[1]))].sort();

    expect(rendered).toEqual(selectable);
    expect(rendered).toContain('deps'); // the list is non-trivial — a mutual-empty match is not a pass
  });

  it('drives navigation with radios, not React state', () => {
    // 2 view radios (overview + repositories — Dependencies is a per-repo TAB, not a view)
    // + 1 repo-selection radio per repo + 4 tab radios per repo.
    const radios = html.match(/type="radio"/g) ?? [];
    expect(radios).toHaveLength(2 + data.repos.length + data.repos.length * 4);
  });

  it('emits the data-testid vocabulary the generator’s tests assert on', () => {
    for (const id of ['repos', 'vulnerabilities', 'actions', 'passrate', 'fixed', 'broken', 'blocked', 'skipped', 'bug']) {
      expect(html).toContain(`data-testid="stat-${id}"`);
    }
    expect(html).toContain('data-testid="passrate-note"');
  });

  it('explains every stat tile in a prerendered hover bubble, with no JS', () => {
    // Same contract as the column bubbles below: CONTENT revealed by CSS, not an enhancement
    // mounted on hover. Every one of the nine tiles carries a badge and a non-empty explanation.
    const ids = ['repos', 'vulnerabilities', 'actions', 'passrate', 'fixed', 'broken', 'blocked', 'skipped', 'bug'];
    for (const id of ids) {
      const tile = new RegExp(
        `data-testid="stat-${id}".*?<span class="stat-pop" role="tooltip">([^<]+)</span>`,
      ).exec(html);
      expect(tile, `tile ${id} has no prerendered tooltip`).not.toBeNull();
      expect(tile?.[1].length).toBeGreaterThan(20);
    }
    expect(html.match(/class="stat-i"/g) ?? []).toHaveLength(ids.length);
    expect(html.match(/class="stat-pop"/g) ?? []).toHaveLength(ids.length);

    // The badge hangs off the LABEL, never between the tile and its value: the pack's matrix tests
    // regex `data-testid="stat-x"[^>]*><div class="stat-value">` out of the emitted HTML, and any
    // markup (or whitespace) in that gap breaks a test in another package entirely.
    for (const id of ids) {
      expect(html).toMatch(new RegExp(`data-testid="stat-${id}"[^>]*><div class="stat-value">`));
    }

    // The distinction these tiles exist to defend (0033): a down registry is not a broken edit.
    expect(html).toContain('Not a verdict on the edit');
    // …and the one the table's ADVISORIES tooltip makes from the other side (0056/A1).
    expect(html).toContain('a package-rule pin is an action with no advisory');
  });

  it('explains every run-results column in a prerendered hover bubble, with no JS', () => {
    // The bubble is CONTENT revealed by CSS, not an enhancement mounted on hover: it must be in the
    // prerendered string, or a reader with JS off gets a badge that promises an explanation and a
    // tooltip that never opens. Each column: a testid'd <th>, an info badge, a non-empty bubble.
    const cols = ['repository', 'environment', 'advisories', 'top-severity', 'stages', 'run-time', 'outcome'];
    for (const c of cols) {
      const th = new RegExp(
        `<th data-testid="col-${c}">.*?<span class="th-pop" role="tooltip">([^<]+)</span>`,
      ).exec(html);
      expect(th, `column ${c} has no prerendered tooltip`).not.toBeNull();
      expect(th?.[1].length).toBeGreaterThan(20);
    }
    expect(html.match(/class="th-i"/g) ?? []).toHaveLength(cols.length);
    expect(html.match(/class="th-pop"/g) ?? []).toHaveLength(cols.length);

    // The two the tooltips exist to disambiguate (records 0056/A1 and 0056/A2) must actually say so.
    expect(html).toContain('not the number of fixes written');
    expect(html).toContain('overall verdict');

    // No `title` on the headers: a native tooltip alongside the bubble means the browser opens its
    // own, unstyled, a second later — two tooltips saying the same thing.
    expect(/<th title=/.test(html)).toBe(false);
  });

  it('prerenders the two version roll-ups — the bars and the split, with no JS', () => {
    // Both are content, not enhancements: they summarize what the run WROTE, and a reader with JS
    // off must see the summary, not an empty card that fills in on hydration.
    expect(html).toContain('data-testid="semver-totals"');
    expect(html).toContain('data-testid="mechanism-split"');
    expect(html.match(/data-testid="semver-bar"/g) ?? []).toHaveLength(3); // major / minor / patch
    expect(html.match(/data-testid="mechanism-bucket"/g) ?? []).toHaveLength(2);
    expect(html).toContain('data-mech="upgrade"');
    expect(html).toContain('data-mech="override"');
  });

  it('prerenders the version-changes table — every row, with no JS', () => {
    // The section is content, not an enhancement: a reader with JS off must see what the run wrote.
    expect(html).toContain('data-testid="version-changes"');
    const rows = html.match(/data-testid="version-change-row"/g) ?? [];
    expect(rows).toHaveLength(data.repos.flatMap((r) => r.reps).length);
    expect(html).toContain('data-bump="major"');
  });
});

describe('hydration', () => {
  let errors: unknown[][];
  let container: HTMLElement;

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args));
    vi.spyOn(console, 'warn').mockImplementation((...args) => void errors.push(args));
    container = document.createElement('div');
    container.id = 'root';
    container.innerHTML = prerender();
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('hydrates the prerendered markup with no mismatch', async () => {
    await act(async () => {
      hydrateRoot(container, <Report data={data} />);
    });

    const complaints = errors.map((e) => String(e[0])).filter((m) => /hydrat|did not match|mismatch/i.test(m));
    expect(complaints, `React complained during hydration:\n${complaints.join('\n')}`).toHaveLength(0);
    expect(errors, `React logged errors/warnings:\n${errors.map((e) => String(e[0])).join('\n')}`).toHaveLength(0);
  });

  it('keeps every repo card in the DOM after hydration', async () => {
    await act(async () => {
      hydrateRoot(container, <Report data={data} />);
    });
    expect(container.querySelectorAll('[data-testid="repo-card"]')).toHaveLength(data.repos.length);
  });
});

/**
 * The topbar carries TWO denominators, and conflating them is the whole risk of this row.
 *
 * `passRate` is fixed ÷ DECIDED (record 0033 keeps blocked and skipped out, so a down registry
 * cannot depress the score). The blocked/skipped chips are shares of ALL actions. The fixture makes
 * the two provably different — 75% pass, but fixed is only 3 of 7 attempts — so a regression that
 * "simplified" both onto one denominator cannot pass this suite.
 */
describe('topbar outcome chips', () => {
  // Parse the prerender as DOM rather than regexing it: React SSR interleaves `<!-- -->` separators
  // between adjacent text nodes, so the string "1 blocked" never appears literally in the markup.
  // `textContent` skips the comments and reads what a HUMAN sees, which is what these assertions
  // are actually about.
  const chip = (d: ReportData, id: string) => {
    const doc = new DOMParser().parseFromString(renderToString(<Report data={d} />), 'text/html');
    const el = doc.querySelector(`[data-testid="${id}"]`);
    if (!el) throw new Error(`no chip [data-testid="${id}"] in the prerendered topbar`);
    return { text: el.textContent ?? '', cls: el.className };
  };

  it('prerenders blocked and skipped as shares of ALL actions, with no JS', () => {
    // 1 of 7 attempts = 14%, for each.
    expect(chip(data, 'topbar-blocked').text).toBe('1 blocked · 14%');
    expect(chip(data, 'topbar-skipped').text).toBe('1 skipped · 14%');
  });

  it('does NOT recompute the pass rate over the same denominator', () => {
    // fixed is 3/7 (43%) of the run, but the pass rate is 3/4 decided (75%). Both are correct and
    // they are NOT the same number — that is precisely why each chip states its denominator.
    expect(data.passRate).toBe(75);
    expect(chip(data, 'topbar-pass').text).toBe('75% pass');
    expect(chip(data, 'topbar-pass').text).not.toContain('43');
  });

  it('greys a zero count rather than dropping the chip — absent would read as "not measured"', () => {
    const none: ReportData = { ...data, totals: { ...data.totals, blocked: 0, skipped: 0 } };
    expect(chip(none, 'topbar-blocked').text).toBe('0 blocked · 0%');
    expect(chip(none, 'topbar-blocked').cls).toContain('chip-zero');
    expect(chip(none, 'topbar-skipped').cls).toContain('chip-zero');
  });

  it('reads "—", never 0%, when the run attempted nothing', () => {
    const empty: ReportData = { ...data, totals: { ...data.totals, actions: 0 }, decided: 0, passRate: null };
    expect(chip(empty, 'topbar-pass').text).toBe('—');
    expect(chip(empty, 'topbar-blocked').text).toContain('—');
    expect(chip(empty, 'topbar-blocked').text).not.toContain('0%');
  });
});
