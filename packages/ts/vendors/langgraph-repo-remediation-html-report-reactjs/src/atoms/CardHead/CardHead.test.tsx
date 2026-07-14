import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CardHead } from './CardHead';
import { FeatureFlagProvider } from '../../featureFlags';

describe('CardHead', () => {
  test('renders', () => {
    render(<CardHead title="Vulnerabilities" sub="12 advisories" />);
  expect(screen.getByText('Vulnerabilities')).toBeTruthy();
  expect(screen.getByText('12 advisories')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <CardHead featureFlag="off" title="Vulnerabilities" />
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
