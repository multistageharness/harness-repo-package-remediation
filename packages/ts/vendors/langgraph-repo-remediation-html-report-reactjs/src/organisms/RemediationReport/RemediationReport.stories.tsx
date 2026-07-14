import { FeatureFlagProvider } from '../../featureFlags';
import { BLOCKED_REPO, BROKEN_REPO, FIXED_REPO, SAMPLE_REPOS } from './fixtures';
import { RemediationReport } from './RemediationReport';

export default { title: 'Organisms/RemediationReport', component: RemediationReport };

export const Default = () => <RemediationReport repos={SAMPLE_REPOS} subtitle="session 95703650" />;

/** Uniformly green — the one run shape in which the known defects cannot manifest. */
export const AllFixed = () => <RemediationReport repos={[FIXED_REPO]} />;

/** A failing repo: the outcome chip must be red. */
export const WithBroken = () => <RemediationReport repos={[BROKEN_REPO]} />;

/** Every repo blocked — the pass rate has nothing to divide by and shows an em-dash. */
export const AllBlocked = () => <RemediationReport repos={[BLOCKED_REPO]} />;

export const Empty = () => <RemediationReport repos={[]} />;

/** The mandatory flag-off story. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <RemediationReport featureFlag="report" repos={SAMPLE_REPOS} />
  </FeatureFlagProvider>
);
