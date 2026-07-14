import type { ReactNode } from 'react';
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import styles from './CardHead.module.css';

export interface CardHeadProps extends FeatureFlagProps {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}

/**
 * CardHead — atom. Gated by the mandatory `useFeatureFlag` contract: when `featureFlag`
 * is supplied and resolves OFF, it returns the fallback BEFORE any other work.
 */
export function CardHead({ title, sub, right, featureFlag, featureFlagFallback = null }: CardHeadProps) {
  const visible = useFeatureFlag(featureFlag);
  if (!visible) return <>{featureFlagFallback}</>;

  return (
    <div className={styles.head}>
      <div>
        <h3 className={styles.title}>{title}</h3>
        {sub ? <p className={styles.sub}>{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}
