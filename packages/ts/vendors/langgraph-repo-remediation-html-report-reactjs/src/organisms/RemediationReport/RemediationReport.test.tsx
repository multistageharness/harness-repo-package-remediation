import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { FeatureFlagProvider } from '../../featureFlags';
import { BLOCKED_REPO, BROKEN_REPO, FIXED_REPO, SAMPLE_REPOS } from './fixtures';
import { RemediationReport } from './RemediationReport';

describe('RemediationReport', () => {
  test('renders the title and one card per repository', () => {
    render(<RemediationReport repos={SAMPLE_REPOS} />);
    expect(screen.getByText('Repository remediation report')).toBeTruthy();
    for (const r of SAMPLE_REPOS) expect(screen.getByText(r.name)).toBeTruthy();
  });

  test('pass rate excludes blocked and skipped (record 0033)', () => {
    // 1 fixed + 1 broken decided; the blocked and skipped repos must not drag it down.
    render(<RemediationReport repos={SAMPLE_REPOS} />);
    expect(screen.getByText('50%')).toBeTruthy();
  });

  test('pass rate is an em-dash when nothing was decided', () => {
    render(<RemediationReport repos={[BLOCKED_REPO]} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  test('a broken repo is not reported as green', () => {
    render(<RemediationReport repos={[BROKEN_REPO]} />);
    expect(screen.getAllByText('broken').length).toBeGreaterThan(0);
  });

  test('state transition: opening a repo drills into its detail view', () => {
    render(<RemediationReport repos={[FIXED_REPO]} />);
    fireEvent.click(screen.getByText(FIXED_REPO.name));
    expect(screen.getByTestId('advisory-table')).toBeTruthy();
    expect(screen.getByText('CVE-2021-23337')).toBeTruthy();
  });

  test('primary interaction: the outcome filter narrows the list', () => {
    render(<RemediationReport repos={SAMPLE_REPOS} />);
    // `Broken` is BOTH a filter tab and a Stat label — target the tab by role, or the
    // query is ambiguous and matches two nodes.
    fireEvent.click(screen.getByRole('tab', { name: /Broken/ }));
    expect(screen.getByText(BROKEN_REPO.name)).toBeTruthy();
    expect(screen.queryByText(FIXED_REPO.name)).toBeNull();
  });

  test('renders an empty run without throwing', () => {
    render(<RemediationReport repos={[]} />);
    expect(screen.getByText('No repositories were ingested.')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <RemediationReport featureFlag="report" repos={SAMPLE_REPOS} />
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
