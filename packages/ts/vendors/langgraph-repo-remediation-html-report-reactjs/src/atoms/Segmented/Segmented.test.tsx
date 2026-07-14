import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { Segmented } from './Segmented';
import { FeatureFlagProvider } from '../../featureFlags';

describe('Segmented', () => {
  test('renders', () => {
    const onChange = vi.fn();
  render(<Segmented value="all" onChange={onChange} options={[{ value: 'all', label: 'All' }, { value: 'fixed', label: 'Fixed' }]} />);
  fireEvent.click(screen.getByText('Fixed'));
  expect(onChange).toHaveBeenCalledWith('fixed');
  });

  test('returns null when flag is off', () => {
    const { container } = render(
      <FeatureFlagProvider resolve={() => false}>
        <Segmented featureFlag="off" value="all" onChange={() => {}} options={[]} />
      </FeatureFlagProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
