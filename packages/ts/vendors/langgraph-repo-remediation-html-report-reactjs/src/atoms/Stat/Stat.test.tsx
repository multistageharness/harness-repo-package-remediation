import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Stat } from './Stat';
import { FeatureFlagProvider } from '../../featureFlags';

describe('Stat', () => {
  test('renders', () => {
    render(<Stat label="Fixed" value={12} />);
  expect(screen.getByText('Fixed')).toBeTruthy();
  expect(screen.getByText('12')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <Stat featureFlag="off" label="Fixed" value={12} />
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
