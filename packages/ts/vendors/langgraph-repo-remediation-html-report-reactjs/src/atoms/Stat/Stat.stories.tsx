import { FeatureFlagProvider } from '../../featureFlags';
import { Stat } from './Stat';

export default { title: 'Atoms/Stat', component: Stat };

export const Default = () => <Stat label="Fixed" value={12} tone="good" />;

/** The mandatory flag-off story: the atom renders nothing. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <Stat featureFlag="off" label="Fixed" value={12} />
  </FeatureFlagProvider>
);
