import { FeatureFlagProvider } from '../../featureFlags';
import { StagePill } from './StagePill';

export default { title: 'Molecules/StagePill', component: StagePill };

export const Default = () => <StagePill name="build" status="ok" />;
export const Failed = () => <StagePill name="test" status="failed" />;
export const NotApplicable = () => <StagePill name="build" status="na" />;

/** The mandatory flag-off story. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <StagePill featureFlag="off" name="build" status="ok" />
  </FeatureFlagProvider>
);
