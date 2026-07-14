import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StatusDot } from './StatusDot';
import { FeatureFlagProvider } from '../../featureFlags';

describe('StatusDot', () => {
  test('renders', () => {
    render(<StatusDot status="failed" />);
  expect(screen.getByLabelText('failed')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <StatusDot featureFlag="off" status="ok" />
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
