import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { FeatureFlagProvider } from '../../featureFlags';
import { StagePill } from './StagePill';

describe('StagePill', () => {
  test('renders the stage name and its status', () => {
    render(<StagePill name="build" status="ok" />);
    expect(screen.getByText('build')).toBeTruthy();
    expect(screen.getByText('ok')).toBeTruthy();
  });

  test('renders an n/a stage as not-applicable, not as a pass', () => {
    // Record 0042/A3: an absent build script is NOT a green build.
    render(<StagePill name="build" status="na" />);
    expect(screen.getByText('n/a')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <StagePill featureFlag="off" name="build" status="ok" />
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
