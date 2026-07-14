import { Chip } from '../../../atoms/Chip';
import type { Repo } from '../../../types';
import styles from './parts.module.css';

/** Organism-private. The content-addressed digest of one snapshot. */
export function SnapshotDetail({ repo, id }: { repo: Repo; id: string }) {
  const snap = repo.snapshots.find((s) => s.id === id);
  if (!snap) return null;

  return (
    <div className={styles.snapDetail} data-testid="snapshot-detail">
      <div className={styles.snapRow}>
        <Chip tone="neutral">after {snap.after}</Chip>
        <span className={styles.digest}>{snap.digest}</span>
      </div>
      <p className={styles.snapNote}>
        {snap.files} files — digests are content-addressed; identical inputs produce identical hashes.
      </p>
    </div>
  );
}
