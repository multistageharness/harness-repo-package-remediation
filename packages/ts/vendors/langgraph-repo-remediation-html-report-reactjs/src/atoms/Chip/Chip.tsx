import type { ReactNode } from 'react';

export type ChipTone =
  | 'neutral'
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'fixed'
  | 'broken'
  | 'blocked'
  | 'skipped'
  | 'bug';
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import styles from './Chip.module.css';

/** Join truthy class names — the CSS-module replacement for the source's Tailwind `cx`. */
function cx(...a: Array<string | false | undefined | null>): string {
  return a.filter(Boolean).join(' ');
}

export interface ChipProps extends FeatureFlagProps {
  /** Semantic tone — NOT a Tailwind class string (see src/tokens.ts). */
  tone?: ChipTone;
  children?: ReactNode;
  className?: string;
}

/**
 * Chip — atom. Gated by the mandatory `useFeatureFlag` contract: when `featureFlag`
 * is supplied and resolves OFF, it returns the fallback BEFORE any other work.
 */
export function Chip({ tone = 'neutral', children, className, featureFlag, featureFlagFallback = null }: ChipProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  return <span className={cx(styles.chip, styles[tone], className)}>{children}</span>;
}
