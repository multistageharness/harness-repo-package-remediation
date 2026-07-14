import { useState } from 'react';

import { Card } from '../../../atoms/Card';
import { CardHead } from '../../../atoms/CardHead';
import { Chip } from '../../../atoms/Chip';
import { MetaRow } from '../../../atoms/MetaRow';
import { Segmented } from '../../../atoms/Segmented';
import { SEVERITY_RANK } from '../../../tokens';
import type { Repo } from '../../../types';
import { DependencyGraph } from './DependencyGraph';
import { LogViewer } from './LogViewer';
import { SnapshotDetail } from './SnapshotDetail';
import { SnapshotRail } from './SnapshotRail';
import styles from './parts.module.css';

const TABS = [
  { value: 'advisories', label: 'Advisories' },
  { value: 'graph', label: 'Dependencies' },
  { value: 'logs', label: 'Logs' },
];

/** Organism-private. The drill-down view for one repository. */
export function RepoDetail({ repo }: { repo: Repo }) {
  const [tab, setTab] = useState('advisories');
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const vulns = [...repo.vulns].sort((a, b) => SEVERITY_RANK[a.sev] - SEVERITY_RANK[b.sev]);

  return (
    <div className={styles.detail}>
      <Card>
        <CardHead
          title={repo.name}
          sub={`${repo.eco} — ${repo.vulns.length} advisories`}
          right={<Chip tone={repo.outcome}>{repo.outcome}</Chip>}
        />
        <SnapshotRail repo={repo} active={snapshot} onPick={setSnapshot} />
        {snapshot ? <SnapshotDetail repo={repo} id={snapshot} /> : null}
      </Card>

      <div className={styles.detailGrid}>
        <Card className={styles.detailMain}>
          <CardHead
            title="Evidence"
            right={<Segmented value={tab} onChange={setTab} options={TABS} />}
          />
          <div className={styles.detailBody}>
            {tab === 'advisories' ? (
              <table className={styles.table} data-testid="advisory-table">
                <thead>
                  <tr>
                    <th>CVE</th>
                    <th>Package</th>
                    <th>Severity</th>
                    <th>From</th>
                    <th>To</th>
                  </tr>
                </thead>
                <tbody>
                  {vulns.map((v) => (
                    <tr key={v.cve}>
                      <td className={styles.mono}>{v.cve}</td>
                      <td className={styles.mono}>{v.pkg}</td>
                      <td>
                        <Chip tone={v.sev}>{v.sev}</Chip>
                      </td>
                      <td className={styles.mono}>{v.from}</td>
                      <td className={styles.mono}>{v.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {tab === 'graph' ? <DependencyGraph repo={repo} /> : null}
            {tab === 'logs' ? <LogViewer repo={repo} /> : null}
          </div>
        </Card>

        <aside className={styles.detailSide}>
          <Card>
            <CardHead title="Metadata" />
            <div className={styles.meta}>
              <MetaRow k="Ecosystem" v={repo.eco} mono />
              <MetaRow k="Outcome" v={repo.outcome} mono />
              <MetaRow k="Skill" v={repo.skill ?? '—'} mono />
              <MetaRow k="Advisories" v={repo.vulns.length} />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
