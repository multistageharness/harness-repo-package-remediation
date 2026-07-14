import { FeatureFlagProvider } from '../../featureFlags';
import { MetaRow } from './MetaRow';

export default { title: 'Atoms/MetaRow', component: MetaRow };

export const Default = () => <MetaRow k="Ecosystem" v="node" mono />;

/** The mandatory flag-off story: the atom renders nothing. */
export const Hidden = () => (
  <FeatureFlagProvider resolve={() => false}>
    <MetaRow featureFlag="off" k="Ecosystem" v="node" />
  </FeatureFlagProvider>
);
