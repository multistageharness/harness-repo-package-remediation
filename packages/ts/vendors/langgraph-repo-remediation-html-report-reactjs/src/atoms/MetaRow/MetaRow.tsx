import type { ReactNode } from 'react';
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import styles from './MetaRow.module.css';

/** Join truthy class names — the CSS-module replacement for the source's Tailwind `cx`. */
function cx(...a: Array<string | false | undefined | null>): string {
  return a.filter(Boolean).join(' ');
}

export interface MetaRowProps extends FeatureFlagProps {
  k: ReactNode;
  v: ReactNode;
  mono?: boolean;
}

/**
 * MetaRow — atom. Gated by the mandatory `useFeatureFlag` contract: when `featureFlag`
 * is supplied and resolves OFF, it returns the fallback BEFORE any other work.
 */
export function MetaRow({ k, v, mono, featureFlag, featureFlagFallback = null }: MetaRowProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  return (
    <div className={styles.row}>
      <span className={styles.k}>{k}</span>
      <span className={cx(styles.v, mono && styles.mono)}>{v}</span>
    </div>
  );
}
