/**
 * Semantic tokens.
 *
 * The source JSX passed RAW TAILWIND CLASS STRINGS as a `tone` prop
 * (`tone="bg-rose-50 text-rose-700 ring-rose-200"`). Tailwind is forbidden inside `src/`
 * — components use CSS modules — so `tone` becomes a SEMANTIC token here and each
 * component maps it to one of its own module classes. This is strictly better: the
 * consumer names an intent, not a stylesheet.
 */
import type { Outcome, Severity, StageStatus } from './types';

/** Rank drives severity sort order (critical first). */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
export const OUTCOMES: Outcome[] = ['fixed', 'broken', 'blocked', 'skipped', 'bug'];

/** Human labels for a stage status. */
export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  ok: 'ok',
  failed: 'failed',
  blocked: 'blocked',
  skipped: 'skipped',
  na: 'n/a',
};

/** The pipeline's stage spine, in order. */
export const STAGE_NAMES = [
  'clone',
  'fingerprint',
  'plan',
  'remediate',
  'install',
  'build',
  'test',
  'validate',
] as const;

/**
 * Pass rate = fixed / (fixed + broken + bug). BLOCKED AND SKIPPED ARE EXCLUDED —
 * a repo blocked by a dead registry is not a remediation failure (record 0033).
 */
export function passRate(t: {
  fixed: number;
  broken: number;
  bug: number;
}): number | null {
  const decided = t.fixed + t.broken + t.bug;
  return decided === 0 ? null : Math.round((t.fixed / decided) * 100);
}
