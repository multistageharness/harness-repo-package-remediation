export interface SegmentedOption {
  value: string;
  label: string;
  count?: number;
}
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import styles from './Segmented.module.css';

/** Join truthy class names — the CSS-module replacement for the source's Tailwind `cx`. */
function cx(...a: Array<string | false | undefined | null>): string {
  return a.filter(Boolean).join(' ');
}

export interface SegmentedProps extends FeatureFlagProps {
  value: string;
  onChange: (next: string) => void;
  options: SegmentedOption[];
}

/**
 * Segmented — atom. Gated by the mandatory `useFeatureFlag` contract: when `featureFlag`
 * is supplied and resolves OFF, it returns the fallback BEFORE any other work.
 */
export function Segmented({ value, onChange, options, featureFlag, featureFlagFallback = null }: SegmentedProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  return (
    <div className={styles.wrap} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(styles.btn, value === o.value ? styles.active : styles.idle)}
        >
          {o.label}
          {o.count !== undefined ? <span className={styles.count}>{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
