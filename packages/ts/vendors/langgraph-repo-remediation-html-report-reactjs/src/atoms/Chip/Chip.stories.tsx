import { FeatureFlagProvider } from '../../featureFlags';
import { Chip } from './Chip';

export default { title: 'Atoms/Chip', component: Chip };

export const Default = () => <Chip tone="critical">critical</Chip>;

/** The mandatory flag-off story: the atom renders nothing. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <Chip featureFlag="off">critical</Chip>
  </FeatureFlagProvider>
);
