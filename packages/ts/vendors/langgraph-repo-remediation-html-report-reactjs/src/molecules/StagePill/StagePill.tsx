import { Chip } from '../../atoms/Chip';
import { StatusDot } from '../../atoms/StatusDot';
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import type { StageStatus } from '../../types';
import styles from './StagePill.module.css';

export interface StagePillProps extends FeatureFlagProps {
  name: string;
  status: StageStatus;
}

const TONE: Record<StageStatus, 'fixed' | 'broken' | 'blocked' | 'skipped' | 'neutral'> = {
  ok: 'fixed',
  failed: 'broken',
  blocked: 'blocked',
  skipped: 'skipped',
  na: 'neutral',
};

/**
 * StagePill — molecule. A pipeline stage's name plus its status, as one unit.
 *
 * This is the ONLY true molecule in the source: a purposeful grouping of two atoms
 * (StatusDot + Chip). Everything else either composes nothing (atom) or is used in exactly
 * one place inside the organism (parts/). The skill says do not over-extract.
 */
export function StagePill({ name, status, featureFlag, featureFlagFallback = null }: StagePillProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  return (
    <span className={styles.pill} data-stage={name} data-status={status}>
      <StatusDot status={status} />
      <span className={styles.name}>{name}</span>
      <Chip tone={TONE[status]}>{status === 'na' ? 'n/a' : status}</Chip>
    </span>
  );
}
