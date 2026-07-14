import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import styles from './PassRateDonut.module.css';

export interface PassRateDonutProps extends FeatureFlagProps {
  /** 0-100, or null when nothing was decided (all blocked/skipped). */
  rate: number | null;
  size?: number;
}

/**
 * PassRateDonut — atom. Gated by the mandatory `useFeatureFlag` contract: when `featureFlag`
 * is supplied and resolves OFF, it returns the fallback BEFORE any other work.
 */
export function PassRateDonut({ rate, size = 96, featureFlag, featureFlagFallback = null }: PassRateDonutProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = rate ?? 0;
  const dash = (pct / 100) * c;

  return (
    <div className={styles.wrap} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className={styles.svg} role="img" aria-label={rate === null ? 'no pass rate' : `pass rate ${pct}%`}>
        <circle cx="50" cy="50" r={r} className={styles.track} />
        {rate !== null ? (
          <circle
            cx="50"
            cy="50"
            r={r}
            className={styles.value}
            strokeDasharray={`${dash} ${c - dash}`}
            transform="rotate(-90 50 50)"
          />
        ) : null}
      </svg>
      <div className={styles.center}>{rate === null ? '—' : `${pct}%`}</div>
    </div>
  );
}
