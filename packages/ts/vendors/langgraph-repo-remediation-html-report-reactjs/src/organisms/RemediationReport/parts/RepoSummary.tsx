import { useState } from 'react';

import { Card } from '../../../atoms/Card';
import { Chip } from '../../../atoms/Chip';
import { StagePill } from '../../../molecules/StagePill';
import type { Repo } from '../../../types';
import styles from './parts.module.css';

/** Organism-private. One repo's card in the overview list. */
export function RepoSummary({ repo, onOpen }: { repo: Repo; onOpen: (name: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={styles.summary}>
      <div className={styles.summaryHead}>
        <div className={styles.summaryTitle}>
          <button type="button" className={styles.repoLink} onClick={() => onOpen(repo.name)}>
            {repo.name}
          </button>
          <Chip tone={repo.outcome}>{repo.outcome}</Chip>
          <Chip tone="neutral">{repo.eco}</Chip>
        </div>
        <button
          type="button"
          className={styles.disclose}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide stages' : 'Show stages'}
        </button>
      </div>

      <div className={styles.summaryBody}>
        <span className={styles.vulnCount}>
          {repo.vulns.length} {repo.vulns.length === 1 ? 'advisory' : 'advisories'}
        </span>
        {expanded ? (
          <div className={styles.stageRow} data-testid="stage-row">
            {repo.stages.map((s) => (
              <StagePill key={s.name} name={s.name} status={s.status} />
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
