import { useMemo, useState, type ReactNode } from 'react';

import { PassRateDonut } from '../../atoms/PassRateDonut';
import { Segmented } from '../../atoms/Segmented';
import { useFeatureFlag, type FeatureFlagProps } from '../../featureFlags';
import { passRate } from '../../tokens';
import type { Outcome, Repo, Totals } from '../../types';
import { Overview } from './parts/Overview';
import { RepoDetail } from './parts/RepoDetail';
import styles from './RemediationReport.module.css';

export interface RemediationReportProps extends FeatureFlagProps {
  /**
   * The repositories to report on. The source JSX hardcoded these as a module-level `RAW`
   * const; the consumer owns them now. `dev/example-*.tsx` show the shape.
   */
  repos: Repo[];
  /** Report heading. */
  title?: string;
  /** Rendered under the title — provenance, session id, whatever the consumer wants. */
  subtitle?: ReactNode;
  /** Called when a repository is opened. Optional — the organism tracks selection itself. */
  onOpenRepo?: (name: string) => void;
}

const FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'broken', label: 'Broken' },
  { value: 'blocked', label: 'Blocked' },
];

/**
 * RemediationReport — the organism.
 *
 * Composition root for the repo-remediation report. Owns two pieces of state (the outcome
 * filter and the selected repo) and delegates everything else to atoms, the StagePill
 * molecule, and its own private `parts/`.
 *
 * The pass rate excludes BLOCKED and SKIPPED (record 0033): a repo blocked by a dead
 * registry is not a remediation failure, and counting it as one makes the number lie.
 */
export function RemediationReport({
  repos,
  title = 'Repository remediation report',
  subtitle,
  onOpenRepo,
  featureFlag,
  featureFlagFallback = null,
}: RemediationReportProps) {
  const visible = useFeatureFlag(featureFlag);

  const [filter, setFilter] = useState('all');
  const [openRepo, setOpenRepo] = useState<string | null>(null);

  const totals = useMemo<Totals>(
    () =>
      repos.reduce<Totals>(
        (acc, r) => {
          acc[r.outcome] += 1;
          return acc;
        },
        { fixed: 0, broken: 0, blocked: 0, skipped: 0, bug: 0 },
      ),
    [repos],
  );

  const shown = useMemo(
    () => (filter === 'all' ? repos : repos.filter((r) => r.outcome === (filter as Outcome))),
    [repos, filter],
  );

  const rate = passRate(totals);
  const selected = openRepo ? repos.find((r) => r.name === openRepo) ?? null : null;

  // The gate returns BEFORE any side effect — but after hooks, which React requires to run
  // unconditionally. No effects fire here, so nothing observable happens when it's off.
  if (!visible) return <>{featureFlagFallback}</>;

  const open = (name: string) => {
    setOpenRepo(name);
    onOpenRepo?.(name);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title} id="report-title">
            {title}
          </h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        <div className={styles.headerRight}>
          <PassRateDonut rate={rate} />
          <p className={styles.rateNote}>
            pass rate — blocked and skipped are excluded
          </p>
        </div>
      </header>

      <nav className={styles.toolbar}>
        <Segmented
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setOpenRepo(null);
          }}
          options={FILTERS.map((f) => ({
            ...f,
            count: f.value === 'all' ? repos.length : repos.filter((r) => r.outcome === f.value).length,
          }))}
        />
        {selected ? (
          <button type="button" className={styles.back} onClick={() => setOpenRepo(null)}>
            ← All repositories
          </button>
        ) : null}
      </nav>

      <main className={styles.main}>
        {selected ? (
          <RepoDetail repo={selected} />
        ) : (
          <Overview repos={shown} totals={totals} onOpen={open} />
        )}
      </main>

      <footer className={styles.footer}>
        <p>
          Deterministic and self-contained. Snapshot digests are content-addressed; identical
          inputs produce identical hashes.
        </p>
      </footer>
    </div>
  );
}
