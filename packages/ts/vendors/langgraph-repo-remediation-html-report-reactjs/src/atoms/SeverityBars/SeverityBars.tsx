import { SEVERITIES } from '../../tokens';
import type { Severity } from '../../types';
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import styles from './SeverityBars.module.css';

/** Join truthy class names — the CSS-module replacement for the source's Tailwind `cx`. */
function cx(...a: Array<string | false | undefined | null>): string {
  return a.filter(Boolean).join(' ');
}

export interface SeverityBarsProps extends FeatureFlagProps {
  /** Count per severity. */
  counts: Record<Severity, number>;
}

/**
 * SeverityBars — atom. Gated by the mandatory `useFeatureFlag` contract: when `featureFlag`
 * is supplied and resolves OFF, it returns the fallback BEFORE any other work.
 */
export function SeverityBars({ counts, featureFlag, featureFlagFallback = null }: SeverityBarsProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  const max = Math.max(1, ...SEVERITIES.map((s) => counts[s] ?? 0));

  return (
    <div className={styles.wrap}>
      {SEVERITIES.map((s) => {
        const n = counts[s] ?? 0;
        return (
          <div key={s} className={styles.row}>
            <span className={styles.label}>{s}</span>
            <div className={styles.track}>
              <div
                className={cx(styles.bar, styles[s])}
                style={{ width: `${(n / max) * 100}%` }}
                data-testid={`bar-${s}`}
              />
            </div>
            <span className={styles.count}>{n}</span>
          </div>
        );
      })}
    </div>
  );
}
