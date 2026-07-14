import type { ReactNode } from 'react';
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import styles from './Card.module.css';

/** Join truthy class names — the CSS-module replacement for the source's Tailwind `cx`. */
function cx(...a: Array<string | false | undefined | null>): string {
  return a.filter(Boolean).join(' ');
}

export interface CardProps extends FeatureFlagProps {
  children?: ReactNode;
  className?: string;
}

/**
 * Card — atom. Gated by the mandatory `useFeatureFlag` contract: when `featureFlag`
 * is supplied and resolves OFF, it returns the fallback BEFORE any other work.
 */
export function Card({ children, className, featureFlag, featureFlagFallback = null }: CardProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  return <section className={cx(styles.card, className)}>{children}</section>;
}
