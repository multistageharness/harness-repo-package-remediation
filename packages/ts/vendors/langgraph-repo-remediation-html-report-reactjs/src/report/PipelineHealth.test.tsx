/**
 * PipelineHealth.test.tsx — the pipeline card reports what HAPPENED, not what the pipeline IS.
 *
 * The card this replaces could not fail any of these tests, because it could not fail any test at
 * all: it was a hardcoded list of nine strings and rendered the same bytes for a green run and a
 * wholly failed one. Every assertion here is therefore chosen to be FALSIFIABLE — each one is a
 * claim the old card would have flunked.
 *
 * The fixture is the generator's adversarial run, and it earns its name here: `install` has one
 * failure among four passes (so "one failure never averages into a pass" is testable), and `build`
 * and `test` carry `na` repos (so "not-applicable is counted, never dropped" is testable). A
 * uniformly green fixture would pass a component that hardcoded "passed".
 */
import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server.browser';
import { describe, expect, it } from 'vitest';

import fixture from './__fixtures__/report-data.json';
import { PipelineHealth, stageHealth } from './PipelineHealth';
import type { Repo, ReportData, StageStatus } from './types';

const data = fixture as unknown as ReportData;
const { repos } = data;

const row = (stage: string) =>
  screen.getAllByTestId('pipeline-stage').find((r) => r.getAttribute('data-stage') === stage) as HTMLElement;

/** Count a status straight from the raw fixture — the assertion's independent second opinion. */
const raw = (stage: string, status: StageStatus) =>
  repos.flatMap((r) => r.stages).filter((s) => s.name === stage && s.status === status).length;

describe('stage roll-up', () => {
  it('counts the statuses the pipeline STAMPED — it does not infer them', () => {
    const health = stageHealth(repos);
    expect(health.length).toBeGreaterThan(0);

    for (const h of health) {
      for (const status of ['ok', 'failed', 'blocked', 'skipped', 'na'] as StageStatus[]) {
        expect(h.counts[status], `${h.name}/${status}`).toBe(raw(h.name, status));
      }
      // Nothing is dropped: every stage record a repo carried lands in exactly one bucket.
      const summed = Object.values(h.counts).reduce((a, b) => a + b, 0);
      expect(summed).toBe(h.total);
      expect(h.total).toBe(repos.flatMap((r) => r.stages).filter((s) => s.name === h.name).length);
    }
  });

  it('DERIVES the stage spine from the data instead of hardcoding it', () => {
    // The old card hardcoded nine stages while the generator stamped six. A literal list cannot go
    // stale loudly — it just quietly stops describing the pipeline. So: feed it a spine it has never
    // seen, and it must report that one rather than the one it "knows".
    const invented: Repo[] = [
      { ...repos[0], stages: [{ name: 'teleport', status: 'ok', duration: 1 }] } as Repo,
    ];
    const health = stageHealth(invented);
    expect(health.map((h) => h.name)).toEqual(['teleport']);
    expect(health[0].verdict).toBe('ok');
  });

  it('never lets one failure average into a pass — the verdict is worst-case', () => {
    const install = stageHealth(repos).find((h) => h.name === 'install');
    expect(install).toBeDefined();

    // The fixture's whole point: install mostly passed. A mean, a majority, or a `>50% ok` rule
    // would all call this stage green, and a reader would never look at it again.
    expect(install?.counts.ok).toBeGreaterThan(install?.counts.failed as number);
    expect(install?.verdict).toBe('failed');
  });

  it('counts not-applicable as its own bucket — absent is not zero and is not a pass', () => {
    const build = stageHealth(repos).find((h) => h.name === 'build');
    expect(build?.counts.na).toBeGreaterThan(0); // the fixture's other point
    // The `na` repos are in the total. Folding them out would shrink the denominator and inflate
    // the pass fraction; folding them into `ok` would claim a build that never ran.
    expect(build?.total).toBe(repos.length);
    expect(build?.counts.ok).toBe(raw('build', 'ok'));
  });
});

describe('what the reader is told', () => {
  it('names the steps that failed, in plain words, at the top of the card', () => {
    render(<PipelineHealth repos={repos} rowsN={data.rowsN} />);
    const head = screen.getByTestId('pipeline-headline');

    expect(head.getAttribute('data-tone')).toBe('failed');
    // Three stages fail in the fixture (install / build / test), and the headline must say so
    // rather than reporting a percentage that rounds the failure away.
    expect(head.textContent).toMatch(/3 steps failed/i);
    expect(head.textContent).not.toMatch(/every step passed/i);
  });

  it('reads as passed only when nothing failed anywhere', () => {
    const allOk: Repo[] = repos.map((r) => ({
      ...r,
      stages: r.stages.map((s) => ({ ...s, status: 'ok' as StageStatus })),
    }));
    render(<PipelineHealth repos={allOk} rowsN={data.rowsN} />);

    const head = screen.getByTestId('pipeline-headline');
    expect(head.getAttribute('data-tone')).toBe('ok');
    expect(head.textContent).toMatch(/every step passed/i);
  });

  it('does not claim "every step passed" when a step did not RUN everywhere', () => {
    // This is the real shape of the run this shipped against: nothing failed, nothing blocked, but
    // `test` was skipped for some repositories. "Nothing red" is not the same fact as "all green" —
    // a banner that conflates them tells a reader their dependencies are tested when several were
    // never tested at all. The absence of a failure is not evidence of a pass.
    const partlyTested: Repo[] = repos.map((r, i) => ({
      ...r,
      stages: r.stages.map((s) => ({
        ...s,
        status: (s.name === 'test' && i % 2 === 0 ? 'skipped' : 'ok') as StageStatus,
      })),
    }));
    const skipped = partlyTested.filter((_, i) => i % 2 === 0).length;
    const ran = repos.length - skipped;

    render(<PipelineHealth repos={partlyTested} rowsN={data.rowsN} />);
    const head = screen.getByTestId('pipeline-headline');

    expect(head.textContent).not.toMatch(/every step passed/i);
    expect(head.textContent).toMatch(/nothing failed/i);
    // …and it must say how incomplete, not merely that it is.
    expect(head.textContent).toContain(`${ran} of ${repos.length}`);
    expect(row('test').textContent).toMatch(new RegExp(`${skipped} skipped`, 'i'));
  });

  it('does NOT call a blocked run passed — an outside failure is still not a green run', () => {
    // Record 0033's distinction, in UI form: blocked is excluded from the PASS RATE because it is
    // not a verdict on the edit — but it is emphatically not a pass, and a health panel that showed
    // a dead registry as green would be the same false-verdict defect in a new place.
    //
    // Note the run is built green-except-install, NOT fixture-with-install-blocked: the fixture also
    // fails `build` and `test`, and a genuine failure rightly outranks a block in the headline. To
    // test the blocked path it has to be the WORST thing that happened.
    const blocked: Repo[] = repos.map((r) => ({
      ...r,
      stages: r.stages.map((s) => ({
        ...s,
        status: (s.name === 'install' ? 'blocked' : 'ok') as StageStatus,
      })),
    }));
    render(<PipelineHealth repos={blocked} rowsN={data.rowsN} />);

    expect(screen.getByTestId('pipeline-headline').getAttribute('data-tone')).toBe('blocked');
    expect(row('install').getAttribute('data-verdict')).toBe('blocked');
    // …and it must not be sold as a pass just because it is not a failure.
    expect(screen.getByTestId('pipeline-headline').textContent).not.toMatch(/every step passed/i);
  });

  it('shows the exact split behind every verdict, so the claim can be checked', () => {
    render(<PipelineHealth repos={repos} rowsN={data.rowsN} />);

    const install = row('install');
    expect(install.getAttribute('data-verdict')).toBe('failed');
    // The headline is a judgement; this is the arithmetic under it. Both, always.
    expect(within(install).getByText(`${raw('install', 'ok')}/${repos.length}`)).toBeTruthy();
    expect(install.textContent).toMatch(/failed for 1 repository/i);

    // Every stage keeps its real internal name — an engineer reading a log needs it.
    for (const h of stageHealth(repos)) expect(row(h.name)).toBeTruthy();
  });

  it('refuses to render a green pipeline for a run that processed nothing', () => {
    // The trap: an empty run has no stages, so every "all passed" check is vacuously true and a
    // 0-of-0 bar renders full. It must say nothing ran.
    render(<PipelineHealth repos={[]} rowsN={0} />);

    expect(screen.queryByTestId('pipeline-headline')).toBeNull();
    expect(screen.queryAllByTestId('pipeline-stage')).toHaveLength(0);
    expect(screen.getByTestId('pipeline-empty').textContent).toMatch(/no repositories were processed/i);
  });
});

describe('the no-JS invariant (record 0057/D3)', () => {
  it('prerenders the whole panel — verdict, bars and counts — with no hydration', () => {
    const html = renderToString(<PipelineHealth repos={repos} rowsN={data.rowsN} />);

    // A health panel that only exists after hydration is useless in the artifact this report ships
    // as: an emailed/archived HTML file that a reader opens with no dev server behind it.
    expect(html).toContain('data-testid="pipeline-health"');
    expect(html).toMatch(/3 steps failed/i);
    for (const h of stageHealth(repos)) expect(html).toContain(`data-stage="${h.name}"`);
    expect(html).toContain('data-verdict="failed"');
    // The bar widths are inline style, computed from the counts — they must be in the string too.
    expect(html).toMatch(/class="ph-seg"[^>]*data-status="failed"/);
  });
});
