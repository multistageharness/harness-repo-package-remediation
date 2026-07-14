import { FeatureFlagProvider } from '../../featureFlags';
import { SeverityBars } from './SeverityBars';

export default { title: 'Atoms/SeverityBars', component: SeverityBars };

export const Default = () => <SeverityBars counts={{ critical: 3, high: 5, medium: 2, low: 1 }} />;

/** The mandatory flag-off story: the atom renders nothing. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <SeverityBars featureFlag="off" counts={{ critical: 0, high: 0, medium: 0, low: 0 }} />
  </FeatureFlagProvider>
);
