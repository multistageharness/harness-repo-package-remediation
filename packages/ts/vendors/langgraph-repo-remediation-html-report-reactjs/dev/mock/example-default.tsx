/**
 * Happy path (route `/mock/`) — the run exactly as the flow emitted it.
 *
 * This is the reference integration: mirror it when wiring a consumer. The repos come from a REAL
 * emitted session (`./data.ts` → the report page's own JSON island), adapted to the mock's older
 * contract by `./adapt.ts`. It is no longer a hand-written fixture — see `dev/variants.ts` for why
 * every example is now a variant of one real dataset.
 */
import { RemediationReport } from '../../src';
import { mockRepos, subtitle } from './data';

const VARIANT = 'as-run';

export default function ExampleDefault() {
  const repos = mockRepos(VARIANT);
  return (
    <RemediationReport
      repos={repos}
      subtitle={subtitle(VARIANT, repos)}
      onOpenRepo={(name) => console.log('opened', name)}
    />
  );
}
