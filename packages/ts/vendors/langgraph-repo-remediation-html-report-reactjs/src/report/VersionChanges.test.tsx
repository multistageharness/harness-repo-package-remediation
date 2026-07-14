/**
 * VersionChanges.test.tsx — the section renders the RECORDS, and says so honestly.
 *
 * The fixture is the generator's adversarial run (`scripts/regenerate-fixture.mjs`), which is the
 * only reason these assertions mean anything: it contains a remediation with `applied: false`, and a
 * repo with no remediation records at all. A uniformly green fixture would pass every test below
 * while the component silently rendered the plan — which is the exact way record 0056/A1's defect
 * survived a dedicated test file and 500+ passing tests.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import fixture from './__fixtures__/report-data.json';
import type { ReportData } from './types';
import { changesOf, VersionChanges } from './VersionChanges';

const data = fixture as unknown as ReportData;

describe('the rows come from the remediation records, not the plan', () => {
  it('emits exactly one row per record — not one per advisory', () => {
    const records = data.repos.flatMap((r) => r.reps);
    expect(changesOf(data.repos)).toHaveLength(records.length);

    // The `vulns` view is the tempting one to render (it has a `pkg`, a `from` and a `to`), and it
    // is a DIFFERENT list: the fixture's rule-injected repo carries a pin with no advisory behind
    // it, so a vuln-driven table silently loses a real change. 7 records, 6 advisories.
    expect(records.length).not.toBe(data.totals.vulns);
    expect(records).toHaveLength(7);
  });

  it('shows a record that was NOT applied, rather than dropping it', () => {
    render(<VersionChanges repos={data.repos} />);
    const rows = screen.getAllByTestId('version-change-row');
    const notApplied = rows.filter((r) => within(r).queryByText('not applied'));

    expect(notApplied.length).toBeGreaterThan(0);
    // …and it carries the reason the record recorded. A dropped row would read as "nothing to do",
    // which is a different claim from "we tried and stopped".
    const chip = within(notApplied[0]).getByText('not applied');
    expect(chip.getAttribute('title')).toBe('no fix available below the major boundary');
  });

  it('names a repository that wrote nothing instead of omitting it', () => {
    // Every repo in the adversarial run wrote at least one record, so the silent case is constructed
    // rather than asserted out of the fixture — a repo whose remediation reached the manifests not
    // at all, which is what a blocked run produces for EVERY repo (record 0054).
    const [wrote, ...rest] = data.repos;
    const silent = { ...rest[0], key: 'wrote-nothing', reps: [] };

    render(<VersionChanges repos={[wrote, silent] as ReportData['repos']} />);
    const note = screen.getByTestId('version-changes-note');
    expect(note.textContent).toContain('wrote-nothing');
    // The rows that DID happen are still there — the note supplements the table, it does not replace it.
    expect(screen.getAllByTestId('version-change-row')).toHaveLength(wrote.reps.length);
  });

  it('says nothing about silent repositories when there are none', () => {
    render(<VersionChanges repos={data.repos} />);
    expect(screen.queryByTestId('version-changes-note')).toBeNull();
  });
});

describe('the bump level', () => {
  it('is rendered from the data, never computed here', () => {
    render(<VersionChanges repos={data.repos} />);
    const rows = screen.getAllByTestId('version-change-row');

    const levels = data.repos.flatMap((r) => r.reps).map((rep) => rep.bump);
    // Every level on screen is the one the generator stamped — same order, same value.
    rows.forEach((row, i) => {
      const chip = row.querySelector('.chip-bump');
      expect(chip?.getAttribute('data-bump')).toBe(levels[i]);
      expect(chip?.textContent).toBe(levels[i]);
    });

    // The adversarial run really does span the vocabulary — a fixture of all-patch would let a
    // hardcoded chip pass.
    expect(new Set(levels).size).toBeGreaterThan(1);
    expect(levels).toContain('major');
  });

  it('falls back to `unknown` for an island written before the field existed — never to a guess', () => {
    const [repo] = data.repos;
    const legacy = {
      ...repo,
      reps: [{ package: 'left-pad', applied: true, from: '1.0.0', to: '2.0.0' }],
    };

    render(<VersionChanges repos={[legacy] as ReportData['repos']} />);
    const chip = screen.getByTestId('version-change-row').querySelector('.chip-bump');
    // `1.0.0 → 2.0.0` is plainly a major bump, and the component still refuses to say so: deriving
    // it here is what the data layer is for (`generator/src/bump.mjs`).
    expect(chip?.getAttribute('data-bump')).toBe('unknown');
  });
});

describe('a run that wrote nothing', () => {
  it('says so, rather than rendering an empty table', () => {
    render(<VersionChanges repos={[]} />);
    expect(screen.getByTestId('version-changes-empty')).toBeTruthy();
    expect(screen.queryByTestId('version-change-row')).toBeNull();
  });
});
