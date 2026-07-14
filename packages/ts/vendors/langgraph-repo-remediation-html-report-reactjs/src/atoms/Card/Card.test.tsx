import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Card } from './Card';
import { FeatureFlagProvider } from '../../featureFlags';

describe('Card', () => {
  test('renders', () => {
    render(<Card>hello</Card>);
  expect(screen.getByText('hello')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <Card featureFlag="off">hello</Card>
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
