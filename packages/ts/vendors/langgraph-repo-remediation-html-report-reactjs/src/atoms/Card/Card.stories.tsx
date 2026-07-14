import { FeatureFlagProvider } from '../../featureFlags';
import { Card } from './Card';

export default { title: 'Atoms/Card', component: Card };

export const Default = () => <Card><p style={{ padding: 20 }}>Card body</p></Card>;

/** The mandatory flag-off story: the atom renders nothing. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <Card featureFlag="off">hello</Card>
  </FeatureFlagProvider>
);
