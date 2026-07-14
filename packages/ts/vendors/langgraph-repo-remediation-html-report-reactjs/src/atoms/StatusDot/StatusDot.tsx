import type { StageStatus } from '../../types';
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import styles from './StatusDot.module.css';

/** Join truthy class names — the CSS-module replacement for the source's Tailwind `cx`. */
function cx(...a: Array<string | false | undefined | null>): string {
  return a.filter(Boolean).join(' ');
}

export interface StatusDotProps extends FeatureFlagProps {
  status: StageStatus;
}

/**
 * StatusDot — atom. Gated by the mandatory `useFeatureFlag` contract: when `featureFlag`
 * is supplied and resolves OFF, it returns the fallback BEFORE any other work.
 */
export function StatusDot({ status, featureFlag, featureFlagFallback = null }: StatusDotProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  return (
    <span
      role="img"
      aria-label={status}
      data-status={status}
      className={cx(styles.dot, styles[status])}
    />
  );
}
