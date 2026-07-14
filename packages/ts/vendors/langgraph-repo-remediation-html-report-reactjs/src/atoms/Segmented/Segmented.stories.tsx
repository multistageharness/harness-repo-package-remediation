import { FeatureFlagProvider } from '../../featureFlags';
import { Segmented } from './Segmented';

export default { title: 'Atoms/Segmented', component: Segmented };

export const Default = () => <Segmented value="all" onChange={() => {}} options={[{ value: 'all', label: 'All', count: 10 }, { value: 'fixed', label: 'Fixed', count: 5 }]} />;

/** The mandatory flag-off story: the atom renders nothing. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <Segmented featureFlag="off" value="all" onChange={() => {}} options={[]} />
  </FeatureFlagProvider>
);
