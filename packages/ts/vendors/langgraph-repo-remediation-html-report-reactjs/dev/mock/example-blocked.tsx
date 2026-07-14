/**
 * All blocked (route `/mock/blocked`) — the registry was down.
 *
 * The SAME repos as `/mock/`, run through the `blocked` variant (`dev/variants.ts`): every outcome
 * blocked, every stage from `remediate` onward blocked, no remediation records. Because the real run
 * is the input, this is the actual repo set a reader would see in that outage — not two copies of an
 * invented `BLOCKED_REPO`.
 *
 * The pass rate must show an EM-DASH, not `0%`: nothing was decided, and reporting 0% would blame the
 * remediation for an infrastructure outage (records 0033, 0054).
 */
import { RemediationReport } from '../../src';
import { mockRepos, subtitle } from './data';

const VARIANT = 'blocked';

export default function ExampleBlocked() {
  const repos = mockRepos(VARIANT);
  return <RemediationReport repos={repos} subtitle={subtitle(VARIANT, repos)} />;
}
