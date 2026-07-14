import { FeatureFlagProvider } from '../../featureFlags';
import { CardHead } from './CardHead';

export default { title: 'Atoms/CardHead', component: CardHead };

export const Default = () => <CardHead title="Vulnerabilities" sub="12 advisories" />;

/** The mandatory flag-off story: the atom renders nothing. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <CardHead featureFlag="off" title="Vulnerabilities" />
  </FeatureFlagProvider>
);
