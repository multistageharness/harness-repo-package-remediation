import { createContext, useContext } from 'react';

/**
 * Resolves a feature-flag key to on/off. A missing key is ON — components are visible by
 * default, and a flag is an opt-in way to hide one.
 */
export type FeatureFlagResolver = (key: string) => boolean;

export const FeatureFlagContext = createContext<FeatureFlagResolver | null>(null);

/**
 * The mandatory visibility gate. Every top-level atom, molecule, and organism calls this
 * and early-returns its fallback when the flag is off — BEFORE any side effect.
 *
 * `undefined` key → always visible (the common case; the gate is opt-in).
 */
export function useFeatureFlag(key?: string): boolean {
  const resolve = useContext(FeatureFlagContext);
  if (!key) return true;
  if (!resolve) return true;
  return resolve(key);
}

/** Props every gated component accepts. */
export interface FeatureFlagProps {
  /** When supplied and resolved OFF, the component renders `featureFlagFallback`. */
  featureFlag?: string;
  /** What to render when the flag is off. Defaults to `null`. */
  featureFlagFallback?: React.ReactNode;
}
