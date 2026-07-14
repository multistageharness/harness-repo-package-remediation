import { FeatureFlagProvider } from '../../featureFlags';
import { StatusDot } from './StatusDot';

export default { title: 'Atoms/StatusDot', component: StatusDot };

export const Default = () => <StatusDot status="ok" />;

/** The mandatory flag-off story: the atom renders nothing. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <StatusDot featureFlag="off" status="ok" />
  </FeatureFlagProvider>
);
