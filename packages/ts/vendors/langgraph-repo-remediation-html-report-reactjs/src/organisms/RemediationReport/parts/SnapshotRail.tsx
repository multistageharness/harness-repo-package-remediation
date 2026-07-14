import { StatusDot } from '../../../atoms/StatusDot';
import type { Repo } from '../../../types';
import styles from './parts.module.css';

/** Organism-private. The horizontal stage rail; picking a stage selects its snapshot. */
export function SnapshotRail({
  repo,
  active,
  onPick,
}: {
  repo: Repo;
  active: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <div className={styles.rail} role="tablist" aria-label="pipeline stages">
      {repo.stages.map((s) => {
        const snap = repo.snapshots.find((sn) => sn.after === s.name);
        const selected = snap ? snap.id === active : false;
        return (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={!snap}
            onClick={() => onPick(snap ? (selected ? null : snap.id) : null)}
            className={[styles.railStop, selected && styles.railStopActive].filter(Boolean).join(' ')}
            data-testid={`rail-${s.name}`}
          >
            <StatusDot status={s.status} />
            <span className={styles.railName}>{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}
