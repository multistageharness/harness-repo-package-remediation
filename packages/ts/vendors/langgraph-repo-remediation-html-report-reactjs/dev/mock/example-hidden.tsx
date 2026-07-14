/**
 * Flag off (route `/mock/hidden`) — the organism renders its fallback instead of the report.
 *
 * Same real session, same `as-run` variant as `/mock/` — the ONLY difference is the flag. That is the
 * point of holding the data fixed across the examples: what changes on screen between two routes is
 * exactly what the route is demonstrating, and nothing else.
 */
import { FeatureFlagProvider, RemediationReport } from '../../src';
import { mockRepos, subtitle } from './data';

const VARIANT = 'as-run';

export default function ExampleHidden() {
  const repos = mockRepos(VARIANT);
  return (
    <FeatureFlagProvider resolve={(key) => key !== 'report'}>
      <RemediationReport
        featureFlag="report"
        featureFlagFallback={
          <p className="p-10 text-sm text-slate-500">
            The report is hidden — feature flag <code>report</code> resolved OFF.
          </p>
        }
        repos={repos}
        subtitle={subtitle(VARIANT, repos)}
      />
    </FeatureFlagProvider>
  );
}
