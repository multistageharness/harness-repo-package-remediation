import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Chip } from './Chip';
import { FeatureFlagProvider } from '../../featureFlags';

describe('Chip', () => {
  test('renders', () => {
    render(<Chip tone="critical">critical</Chip>);
  expect(screen.getByText('critical')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <Chip featureFlag="off">critical</Chip>
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
