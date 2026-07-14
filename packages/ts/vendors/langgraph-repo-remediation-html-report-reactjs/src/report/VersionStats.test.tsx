/**
 * VersionStats.test.tsx — the two roll-ups count what was WRITTEN, and refuse to guess.
 *
 * The fixture is the generator's adversarial run, and every assertion here leans on the two things
 * that make it adversarial: it contains a record with `applied: false` (so "counts only what was
 * written" is falsifiable) and a repo whose fix was a transitive pin rather than a version bump (so
 * "upgrade vs override" has two populated buckets). A uniformly green, all-direct-bump fixture would
 * pass a component that counted the plan and hardcoded the mechanism.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import fixture from './__fixtures__/report-data.json';
import type { ReportData } from './types';
import { bumpTotals, mechanismSplit, SemverTotals, UpgradeOverrideSplit } from './VersionStats';

const data = fixture as unknown as ReportData;
const reps = data.repos.flatMap((r) => r.reps);
const bucket = (mech: 'upgrade' | 'override') =>
  screen.getAllByTestId('mechanism-bucket').find((b) => b.getAttribute('data-mech') === mech) as HTMLElement;

describe('semantic-versioning totals', () => {
  it('counts the levels the DATA stamped — it does not parse a version', () => {
    const totals = bumpTotals(data.repos);
    const applied = reps.filter((r) => r.applied);

    // Same tally, computed from the records' own `bump` field. The adversarial run spans the
    // vocabulary, so a component that hardcoded a level could not pass this.
    for (const level of ['major', 'minor', 'patch'] as const) {
      expect(totals[level]).toBe(applied.filter((r) => r.bump === level).length);
    }
    expect(totals.major + totals.minor + totals.patch).toBe(applied.length);
    expect(new Set(applied.map((r) => r.bump)).size).toBeGreaterThan(1);
  });

  it('excludes a planned change that was never written — a move that did not happen has no size', () => {
    const skipped = reps.filter((r) => !r.applied);
    expect(skipped.length).toBeGreaterThan(0); // the fixture's whole point

    const totals = bumpTotals(data.repos);
    const charted = Object.values(totals).reduce((a, n) => a + n, 0);
    expect(charted).toBe(reps.length - skipped.length);

    // …and the exclusion is stated, not silent. A bar chart that quietly drops rows is how a report
    // ends up claiming work it did not do (record 0056/A1).
    render(<SemverTotals repos={data.repos} />);
    expect(screen.getByTestId('semver-totals-note').textContent).toContain('not written');
  });

  it('always charts major/minor/patch, and charts an off-semver level only when one occurred', () => {
    render(<SemverTotals repos={data.repos} />);
    const levels = screen.getAllByTestId('semver-bar').map((b) => b.getAttribute('data-bump'));

    expect(levels).toEqual(['major', 'minor', 'patch']); // no `downgrade`/`same`/`unknown` in this run

    // A run that DID downgrade must not have that quietly dropped from the chart that totals it.
    const [repo] = data.repos;
    const rolled = {
      ...repo,
      reps: [{ package: 'left-pad', applied: true, from: '2.0.0', to: '1.0.0', bump: 'downgrade' }],
    };
    render(<UpgradeOverrideSplit repos={[]} />); // isolate: fresh tree below
    const { getAllByTestId } = within(
      render(<SemverTotals repos={[rolled] as unknown as ReportData['repos']} />).container,
    );
    expect(getAllByTestId('semver-bar').map((b) => b.getAttribute('data-bump'))).toContain('downgrade');
  });
});

describe('upgrades vs overrides', () => {
  it('splits the written changes by the mechanism the remediate atom recorded', () => {
    const { buckets } = mechanismSplit(data.repos);
    const applied = reps.filter((r) => r.applied);

    expect(buckets['direct-bump'].pkgs).toBe(applied.filter((r) => r.strategy === 'direct-bump').length);
    expect(buckets['transitive-pin'].pkgs).toBe(applied.filter((r) => r.strategy === 'transitive-pin').length);
    // Both buckets are populated — otherwise "vs" is untested.
    expect(buckets['direct-bump'].pkgs).toBeGreaterThan(0);
    expect(buckets['transitive-pin'].pkgs).toBeGreaterThan(0);
  });

  it('names the repositories in each bucket', () => {
    render(<UpgradeOverrideSplit repos={data.repos} />);

    // `rule-injected` had a transitive pin written (`semver`, via a package rule) AND a direct bump
    // (`axios`) — it belongs to both, and a partition would have to lie about one of them.
    expect(within(bucket('override')).getByText('rule-injected')).toBeTruthy();
    expect(within(bucket('upgrade')).getByText('rule-injected')).toBeTruthy();
    expect(screen.getByTestId('mechanism-split-note').textContent).toContain('both buckets');
  });

  it('does not count a SKIPPED override as an override applied', () => {
    const { buckets } = mechanismSplit(data.repos);
    // `skipped-rem`'s minimist pin was planned as a transitive-pin and never written. The repo's
    // OTHER package (lodash) was upgraded, so it belongs in the upgrade bucket and nowhere else.
    expect(buckets['direct-bump'].repos).toContain('skipped-rem');
    expect(buckets['transitive-pin'].repos).not.toContain('skipped-rem');
  });

  it('counts a record with no recorded mechanism as unclassified — never as an upgrade', () => {
    const [repo] = data.repos;
    const legacy = {
      ...repo,
      key: 'legacy-island',
      reps: [{ package: 'left-pad', applied: true, from: '1.0.0', to: '1.0.1', bump: 'patch' }],
    };

    const { buckets, unclassified } = mechanismSplit([legacy] as unknown as ReportData['repos']);
    expect(unclassified).toBe(1);
    expect(buckets['direct-bump'].pkgs).toBe(0);
    expect(buckets['transitive-pin'].pkgs).toBe(0);

    render(<UpgradeOverrideSplit repos={[legacy] as unknown as ReportData['repos']} />);
    expect(screen.getByTestId('mechanism-split-note').textContent).toContain('no recorded mechanism');
  });
});
