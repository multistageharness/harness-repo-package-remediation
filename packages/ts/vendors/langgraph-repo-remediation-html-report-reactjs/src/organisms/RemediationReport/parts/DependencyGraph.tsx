import { useMemo } from 'react';

import type { Repo } from '../../../types';
import styles from './parts.module.css';

/** Organism-private. A dependency graph laid out deterministically (no random, no clock). */
export function DependencyGraph({ repo }: { repo: Repo }) {
  const layout = useMemo(() => {
    const { nodes, edges } = repo.deps;
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const pos = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
      pos.set(n, { x: (i % cols) * 120 + 60, y: Math.floor(i / cols) * 80 + 40 });
    });
    return { pos, edges, nodes, height: (Math.floor((nodes.length - 1) / cols) + 1) * 80 + 40 };
  }, [repo.deps]);

  if (repo.deps.nodes.length === 0) {
    return <p className={styles.empty}>No dependency graph was captured for this repository.</p>;
  }

  return (
    <svg
      viewBox={`0 0 ${Math.max(360, 120 * Math.ceil(Math.sqrt(layout.nodes.length)))} ${layout.height}`}
      className={styles.graph}
      role="img"
      aria-label="dependency graph"
      data-testid="dependency-graph"
    >
      {layout.edges.map((e) => {
        const a = layout.pos.get(e.from);
        const b = layout.pos.get(e.to);
        if (!a || !b) return null;
        return (
          <line key={`${e.from}->${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={styles.edge} />
        );
      })}
      {layout.nodes.map((n) => {
        const p = layout.pos.get(n);
        if (!p) return null;
        return (
          <g key={n} transform={`translate(${p.x} ${p.y})`} className={styles.nodeGroup}>
            <circle r={5} className={styles.node} />
            <text y={-12} textAnchor="middle" className={styles.nodeLabel}>
              {n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
