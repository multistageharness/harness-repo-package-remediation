/**
 * DependencyInventory.test.tsx — one repository's package inventory (its Dependencies tab).
 *
 * The assertions that matter here are not "it renders a table". They are the ones the DATA had to be
 * fixed to make true, and which a component could quietly un-make:
 *
 *   1. AN UNRESOLVED VERSION IS NOT A CONFLICTING ONE. In `rule-injected`, `lodash` is resolved at
 *      4.17.20 at the top level and listed with no version at all in a nested copy. That is one known
 *      version and one unmeasured one — it must NOT be counted as a version conflict, or the report
 *      tells a reader two different versions are installed when it does not know that. `semver` in
 *      `na-build` (7.3.0 under tar, 7.5.4 hoisted) is the real thing, and the two must never collapse.
 *
 *   2. THE SCOPE IS THE REPO. `semver` is 7.5.4 in `rule-injected` and 7.3.0 in `na-build` — those two
 *      repos disagree with each other, and that was a `conflict` while this was a run-wide view. It is
 *      not one now: a per-repo table that flagged it would point at a repo for a fact about the run.
 *
 *   3. A REPO WITH NO GRAPH SAYS SO. `broken-repo` produced none. An empty table with no explanation
 *      reads as "this repository has no dependencies", which is never true.
 */
import { renderToString } from 'react-dom/server.browser';
import { describe, expect, it } from 'vitest';

import { DependencyInventory } from './DependencyInventory';
import fixture from './__fixtures__/report-data.json';
import type { PackageEntry, ReportData, Repo } from './types';

const data = fixture as unknown as ReportData;
const repo = (key: string) => data.repos.find((r) => r.key === key) as Repo;
const pkgs = (key: string) => repo(key).inventory?.packages ?? [];
const byName = (key: string, n: string) => pkgs(key).find((p) => p.name === n) as PackageEntry;

const html = (key: string) => renderToString(<DependencyInventory inventory={repo(key).inventory} />);

describe('the stamped inventory (data layer, not this component)', () => {
  it('is scoped to the repo — every graphed repo carries its own package list', () => {
    expect(pkgs('rule-injected')).toHaveLength(4);
    expect(pkgs('na-build')).toHaveLength(3);
    expect(repo('broken-repo').inventory?.graphed).toBe(false);
  });

  it('counts a package resolved at TWO versions IN ONE TREE as a conflict', () => {
    const semver = byName('na-build', 'semver');
    expect(semver.versions).toEqual(['7.3.0', '7.5.4']);
    expect(semver.conflict).toBe(true);
    expect(semver.unresolved).toBe(false);
    // Pulled in by two different parents — the hoisted copy and the one under tar.
    expect(semver.dependents).toEqual(['na-build-app@0.3.0', 'tar@6.1.0']);
  });

  it('does NOT count an UNRESOLVED observation as a conflicting version', () => {
    const lodash = byName('rule-injected', 'lodash');
    expect(lodash.versions).toEqual(['4.17.20']); // the resolved one, and only it
    expect(lodash.unresolved).toBe(true); // …plus the fact that one copy reported none
    expect(lodash.conflict).toBe(false); // …which is NOT a second version
    // And the placeholder the graph writer bakes into the node id never becomes a version.
    expect(lodash.versions).not.toContain('unknown');
  });

  it('never lets one repo inherit another repo’s version disagreement', () => {
    // rule-injected resolved semver exactly once (7.5.4). na-build resolved it at 7.3.0. The two
    // repos disagree — but that is a fact about the RUN, and neither repo's table may claim it.
    const semver = byName('rule-injected', 'semver');
    expect(semver.versions).toEqual(['7.5.4']);
    expect(semver.conflict).toBe(false);
  });

  it('carries maven coordinates whole — the id-splitting fallback cannot parse them', () => {
    const t = byName('blocked-repo', 'org.apache.commons:commons-text');
    expect(t.versions).toEqual(['1.9']);
    expect(t.dependents).toEqual(['com.example:blocked-app:1.0.0']);
  });
});

describe('prerendered markup (the no-JS invariant)', () => {
  it('renders EVERY package row, not just the filtered ones', () => {
    // Search and the filter buttons only HIDE rows. With the script blocked a reader still gets the
    // whole inventory — an empty table that fills in on hydration would lose it entirely.
    const rows = html('rule-injected').match(/data-testid="dep-row"/g) ?? [];
    expect(rows).toHaveLength(pkgs('rule-injected').length);
  });

  it('expands dependents without JS — a <details>, not React state', () => {
    const h = html('rule-injected');
    expect(h).toContain('<details class="dep-deps">');
    expect(h).toContain('rule-injected-app@2.1.0');
  });

  it('flags the conflict in the repo that HAS one, and nowhere else', () => {
    expect((html('na-build').match(/data-flag="conflict"/g) ?? []).length).toBe(1);
    // rule-injected has the cross-repo disagreement and no conflict of its own — no flag.
    expect(html('rule-injected')).not.toContain('data-flag="conflict"');
  });

  it('renders an unmeasured version as an ABSENCE, never as a version called "unknown"', () => {
    const h = html('rule-injected');
    expect(h).toContain('no version reported');
    expect(h).not.toMatch(/class="dep-ver">unknown</);
  });

  it('states how many packages it speaks for', () => {
    expect(html('na-build')).toContain('data-testid="dep-foot"');
  });
});

describe('a repo whose graph was never captured', () => {
  it('says the graph was not captured — it never implies there are no dependencies', () => {
    const h = html('broken-repo');
    expect(h).toContain('data-testid="dep-empty"');
    expect(h).toContain('absence of measurement');
    expect(h).not.toContain('data-testid="dep-row"');
  });

  it('says the same for an island emitted before the field existed', () => {
    const h = renderToString(<DependencyInventory inventory={undefined} />);
    expect(h).toContain('data-testid="dep-empty"');
    expect(h).not.toContain('data-testid="dep-row"');
  });
});
