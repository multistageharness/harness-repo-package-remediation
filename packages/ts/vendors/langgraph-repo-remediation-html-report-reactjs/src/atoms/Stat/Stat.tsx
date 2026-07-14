import type { ReactNode } from 'react';
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import styles from './Stat.module.css';

/** Join truthy class names — the CSS-module replacement for the source's Tailwind `cx`. */
function cx(...a: Array<string | false | undefined | null>): string {
  return a.filter(Boolean).join(' ');
}

export interface StatProps extends FeatureFlagProps {
  label: ReactNode;
  value: ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'warn';
  emphasis?: boolean;
}

/**
 * Stat — atom. Gated by the mandatory `useFeatureFlag` contract: when `featureFlag`
 * is supplied and resolves OFF, it returns the fallback BEFORE any other work.
 */
export function Stat({ label, value, tone = 'default', emphasis, featureFlag, featureFlagFallback = null }: StatProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  return (
    <div className={cx(styles.stat, emphasis && styles.emphasis)}>
      <div className={cx(styles.value, styles[tone])}>{value}</div>
      <div className={styles.label}>{label}</div>
    </div>
  );
}
