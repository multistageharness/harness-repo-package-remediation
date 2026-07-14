import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MetaRow } from './MetaRow';
import { FeatureFlagProvider } from '../../featureFlags';

describe('MetaRow', () => {
  test('renders', () => {
    render(<MetaRow k="Ecosystem" v="node" />);
  expect(screen.getByText('Ecosystem')).toBeTruthy();
  expect(screen.getByText('node')).toBeTruthy();
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <MetaRow featureFlag="off" k="Ecosystem" v="node" />
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
