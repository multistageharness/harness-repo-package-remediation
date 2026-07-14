import { FeatureFlagProvider } from '../../featureFlags';
import { PassRateDonut } from './PassRateDonut';

export default { title: 'Atoms/PassRateDonut', component: PassRateDonut };

export const Default = () => <PassRateDonut rate={75} />;

/** The mandatory flag-off story: the atom renders nothing. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <PassRateDonut featureFlag="off" rate={75} />
  </FeatureFlagProvider>
);
