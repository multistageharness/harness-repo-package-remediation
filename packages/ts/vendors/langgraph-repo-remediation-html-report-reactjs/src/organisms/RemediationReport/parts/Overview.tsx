import { Card } from '../../../atoms/Card';
import { CardHead } from '../../../atoms/CardHead';
import { SeverityBars } from '../../../atoms/SeverityBars';
import { Stat } from '../../../atoms/Stat';
import { SEVERITIES } from '../../../tokens';
import type { Repo, Severity, Totals } from '../../../types';
import { RepoSummary } from './RepoSummary';
import styles from './parts.module.css';

/** Organism-private. The landing view: aggregate stats + per-repo cards. */
export function Overview({
  repos,
  totals,
  onOpen,
}: {
  repos: Repo[];
  totals: Totals;
  onOpen: (name: string) => void;
}) {
  const counts = SEVERITIES.reduce(
    (acc, s) => {
      acc[s] = repos.reduce((n, r) => n + r.vulns.filter((v) => v.sev === s).length, 0);
      return acc;
    },
    {} as Record<Severity, number>,
  );

  return (
    <div className={styles.overview}>
      <div className={styles.statRow}>
        <Stat label="Repos" value={repos.length} />
        <Stat label="Fixed" value={totals.fixed} tone="good" emphasis />
        <Stat label="Broken" value={totals.broken} tone="bad" />
        <Stat label="Blocked" value={totals.blocked} tone="warn" />
        <Stat label="Skipped" value={totals.skipped} />
      </div>

      <Card>
        <CardHead title="Severity" sub="Advisories across every repository" />
        <div className={styles.sevWrap}>
          <SeverityBars counts={counts} />
        </div>
      </Card>

      <div className={styles.repoList}>
        {repos.length === 0 ? (
          <p className={styles.empty}>No repositories were ingested.</p>
        ) : (
          repos.map((r) => <RepoSummary key={r.name} repo={r} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}
