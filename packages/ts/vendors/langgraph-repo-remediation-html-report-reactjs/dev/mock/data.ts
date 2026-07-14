/**
 * dev/mock/data.ts — the mock examples' single source of data.
 *
 * All four examples read from HERE, and this reads the SAME emitted session the report page reads
 * (`INITIAL` comes from the `virtual:report-sessions` module — the `ReportData` of a real
 * `repo-remediation.html`). One dataset, several variants; no example invents a repo.
 *
 * When no report exists on disk there is deliberately **no fixture fallback** — the examples say what
 * to run instead. A fixture that looks like a report is how the dev harness drifted away from the
 * shipped page to begin with (record 0058), and a fallback would quietly restore exactly that.
 * `src/organisms/RemediationReport/fixtures.ts` still exists for the mock's stories and unit tests,
 * where invented data is the right tool.
 */
import { INITIAL, SESSIONS, SESSIONS_DIR } from 'virtual:report-sessions';

import type { Repo as MockRepo } from '../../src/types';
import { variant } from '../variants';
import { toMockRepos } from './adapt';

export const HAVE_DATA = INITIAL !== null;

/** The session these examples are drawn from — shown in each example's subtitle. */
export const SESSION_ID = SESSIONS[0]?.id ?? '(none)';
export const SESSIONS_ROOT = SESSIONS_DIR;

/** The mock's repos for a given variant of the real run (`as-run`, `blocked`, `empty`). */
export function mockRepos(variantId: string): MockRepo[] {
  if (!INITIAL) return [];
  return toMockRepos(variant(variantId).apply(INITIAL));
}

/** One line naming the data on screen, so no example can be mistaken for a fixture. */
export function subtitle(variantId: string, repos: MockRepo[]): string {
  const v = variant(variantId);
  return `session ${SESSION_ID.slice(0, 8)} · ${repos.length} repositories · ${v.note}`;
}
