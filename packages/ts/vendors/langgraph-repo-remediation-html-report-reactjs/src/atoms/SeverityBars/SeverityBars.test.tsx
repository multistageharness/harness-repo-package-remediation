import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SeverityBars } from './SeverityBars';
import { FeatureFlagProvider } from '../../featureFlags';

describe('SeverityBars', () => {
  test('renders', () => {
    render(<SeverityBars counts={{ critical: 3, high: 5, medium: 2, low: 1 }} />);
  expect(screen.getByTestId('bar-critical')).toBeTruthy();
  expect(screen.getByText('5')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <SeverityBars featureFlag="off" counts={{ critical: 0, high: 0, medium: 0, low: 0 }} />
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
