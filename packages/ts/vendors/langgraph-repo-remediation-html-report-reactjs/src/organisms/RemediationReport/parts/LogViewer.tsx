import { useMemo, useState } from 'react';

import { Segmented } from '../../../atoms/Segmented';
import type { LogLine, Repo } from '../../../types';
import styles from './parts.module.css';

const LEVELS = ['all', 'info', 'warn', 'error'] as const;

/** Organism-private. Filterable stage logs. */
export function LogViewer({ repo }: { repo: Repo }) {
  const [level, setLevel] = useState<string>('all');

  const shown = useMemo<LogLine[]>(
    () => (level === 'all' ? repo.logs : repo.logs.filter((l) => l.level === level)),
    [repo.logs, level],
  );

  return (
    <div className={styles.logs}>
      <Segmented
        value={level}
        onChange={setLevel}
        options={LEVELS.map((l) => ({
          value: l,
          label: l,
          count: l === 'all' ? repo.logs.length : repo.logs.filter((x) => x.level === l).length,
        }))}
      />
      <pre className={styles.logBody} data-testid="log-body">
        {shown.length === 0
          ? 'No log lines at this level.'
          : shown.map((l) => `${l.level.padEnd(5)} ${l.text}`).join('\n')}
      </pre>
    </div>
  );
}
