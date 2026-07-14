/**
 * EnvironmentBanner.test.tsx — the banner renders the STAMPED environment fact
 * (run-health-and-errors-log Epic 03), names the service and the remedy, never
 * re-derives anything, and disappears on a clean run.
 *
 * The fixture is the generator's adversarial run, whose `service_health`
 * really is degraded (docker down, devpi unreachable) with one blocked repo —
 * so "the banner shows the incident" is asserted against the same data shape a
 * real emitted island carries.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EnvironmentBanner } from './EnvironmentBanner';
import fixture from './__fixtures__/report-data.json';
import type { EnvironmentFact, ReportData } from './types';

const data = fixture as unknown as ReportData;

describe('EnvironmentBanner', () => {
  it('the adversarial fixture stamps a degraded environment (the data contract, not a component guess)', () => {
    expect(data.environment?.degraded).toBe(true);
    expect(data.environment?.services.map((s) => s.id)).toEqual(['docker', 'devpi']);
    expect(data.environment?.blocked).toBeGreaterThan(0);
  });

  it('names the down services and prints the probe remedies verbatim', () => {
    render(<EnvironmentBanner environment={data.environment} />);
    const banner = screen.getByTestId('env-banner');
    expect(screen.getByTestId('env-banner-services').textContent).toContain('docker (not running)');
    expect(screen.getByTestId('env-banner-services').textContent).toContain('devpi (unreachable)');
    for (const remedy of data.environment?.remedies ?? []) {
      expect(banner.textContent).toContain(remedy);
    }
    expect(banner.getAttribute('role')).toBe('alert');
  });

  it('mixed causes: the banner never reads as environment-only — a regression must not hide behind Docker', () => {
    // The adversarial run has a broken repo, so its stamped fact IS mixed.
    expect(data.environment?.codeAttributable).toBeGreaterThan(0);
    render(<EnvironmentBanner environment={data.environment} />);
    const banner = screen.getByTestId('env-banner');
    expect(banner.className).toContain('env-banner-mixed');
    expect(banner.textContent).toContain('code-attributable');
    expect(banner.textContent).not.toContain('not a verdict on the code');
  });

  it('environment-only: says the blocked outcomes carry no code verdict', () => {
    const envOnly: EnvironmentFact = { ...(data.environment as EnvironmentFact), codeAttributable: 0 };
    render(<EnvironmentBanner environment={envOnly} />);
    const banner = screen.getByTestId('env-banner');
    expect(banner.textContent).toContain('not a verdict on the code');
    expect(banner.textContent).toContain('say nothing about the changes this run made');
  });

  it('no banner on a clean run, an un-blocked outage, or a pre-banner island', () => {
    const clean: EnvironmentFact = { degraded: false, services: [], remedies: [], blocked: 0, codeAttributable: 0 };
    const { container: c1 } = render(<EnvironmentBanner environment={clean} />);
    expect(c1.innerHTML).toBe('');
    const downButHarmless: EnvironmentFact = { ...(data.environment as EnvironmentFact), blocked: 0 };
    const { container: c2 } = render(<EnvironmentBanner environment={downButHarmless} />);
    expect(c2.innerHTML).toBe('');
    const { container: c3 } = render(<EnvironmentBanner environment={undefined} />);
    expect(c3.innerHTML).toBe('');
  });
});
