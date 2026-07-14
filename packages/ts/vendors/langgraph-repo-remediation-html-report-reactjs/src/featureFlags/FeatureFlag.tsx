import type { ReactNode } from 'react';
import { FeatureFlagContext, useFeatureFlag, type FeatureFlagResolver } from './useFeatureFlag';

/** Supplies the resolver to a consumer tree. Without it, every flag resolves ON. */
export function FeatureFlagProvider({
  resolve,
  children,
}: {
  resolve: FeatureFlagResolver;
  children: ReactNode;
}) {
  return <FeatureFlagContext.Provider value={resolve}>{children}</FeatureFlagContext.Provider>;
}

/** Declarative wrapper around the hook, for gating arbitrary subtrees. */
export function FeatureFlag({
  flag,
  fallback = null,
  children,
}: {
  flag?: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const visible = useFeatureFlag(flag);
  return <>{visible ? children : fallback}</>;
}
