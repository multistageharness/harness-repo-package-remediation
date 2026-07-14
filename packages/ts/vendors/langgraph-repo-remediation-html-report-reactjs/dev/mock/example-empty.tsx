/**
 * Empty state (route `/mock/empty`) — the dataset was read and ingested nothing. Must not throw.
 *
 * The same real session as every other example, through the `empty` variant (`dev/variants.ts`).
 * `repos: []` is the whole point, so this is the one example the dataset cannot show through —
 * it is here to prove the organism survives it.
 */
import { RemediationReport } from '../../src';
import { mockRepos, subtitle } from './data';

const VARIANT = 'empty';

export default function ExampleEmpty() {
  const repos = mockRepos(VARIANT);
  return <RemediationReport repos={repos} subtitle={subtitle(VARIANT, repos)} />;
}
