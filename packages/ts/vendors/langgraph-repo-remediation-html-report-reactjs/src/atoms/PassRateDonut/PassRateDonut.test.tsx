import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PassRateDonut } from './PassRateDonut';
import { FeatureFlagProvider } from '../../featureFlags';

describe('PassRateDonut', () => {
  test('renders', () => {
    render(<PassRateDonut rate={75} />);
  expect(screen.getByText('75%')).toBeTruthy();
  });

  test('renders an em-dash when nothing was decided', () => {
    render(<PassRateDonut rate={null} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <PassRateDonut featureFlag="off" rate={75} />
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
