/**
 * DependencyInventory.tsx — ONE REPOSITORY'S Dependencies tab.
 *
 * The repo's resolved dependency graph, flattened: one row per distinct package, the versions it was
 * observed at, and what pulls it in. It sits inside `RepoDetail`, beside Plan / Logs / Metadata.
 *
 * THIS WAS A TOP-LEVEL, RUN-WIDE VIEW, and moving it into the repo changed one thing that is not
 * cosmetic: what `conflict` MEANS. Run-wide it meant "two repos resolved this package differently"
 * (on the golden run: `typescript` at 5.3.3 in one repo, 6.0.3 in another). Scoped to a repo it means
 * "THIS repo's own graph resolved it at two versions" — a diamond inside one tree, of which that same
 * run has none. Both are honest facts; they are different questions. The data layer answers the
 * scoped one (`generator/src/data.mjs › buildRepoInventory`), and this component must never present a
 * run-wide answer under a repo's heading — flagging a package as conflicting inside a repo that only
 * ever resolved it once would point at a repo for a fact that is not about it.
 *
 * IT PRINTS; IT DOES NOT CLASSIFY. `versions`, `dependents`, `conflict`, `unresolved` and `root` are
 * all stamped in the data layer. In particular this component does NOT decide what a version conflict
 * is — see `PackageEntry` in `types.ts` for why that definition is load-bearing and why an UNRESOLVED
 * observation is not a conflicting one.
 *
 * TWO INVARIANTS SHAPE THE MARKUP (see the html-report-add-section skill):
 *
 *   1. No-JS completeness. EVERY row is prerendered; the search box and the filter buttons only
 *      HIDE rows (`hidden`), exactly as the repo sidebar does. A reader with the script blocked
 *      gets the whole inventory rather than an empty table that fills in on hydration.
 *   2. The dependents list expands with a native `<details>`, not `useState`. It therefore works
 *      with JS off too, and — because it holds no React state — it cannot desync between the
 *      prerender and the hydration.
 */
import { useState } from 'react';

import type { PackageEntry, RepoInventory } from './types';

type FilterId = 'all' | 'conflict' | 'unresolved' | 'root';

const FILTERS: Array<{ id: FilterId; label: string; hint: string }> = [
  { id: 'all', label: 'All', hint: 'every package this repository’s dependency graph observed' },
  {
    id: 'conflict',
    label: 'Version conflicts',
    hint: 'this repository resolved the package at two or more DIFFERENT versions in its own tree',
  },
  {
    id: 'unresolved',
    label: 'Unresolved',
    hint: 'the graph listed the package but reported no version for it — unmeasured, not necessarily different',
  },
  { id: 'root', label: 'Roots', hint: 'nothing depends on them — the repository’s own package' },
];

const passes = (p: PackageEntry, f: FilterId) =>
  f === 'all' || (f === 'conflict' && p.conflict) || (f === 'unresolved' && p.unresolved) || (f === 'root' && p.root);

/** Versions cell: the resolved versions, plus — separately — the fact that some were unmeasured. */
function Versions({ p }: { p: PackageEntry }) {
  return (
    <div className="dep-vers">
      {p.versions.map((v) => (
        <span className="dep-ver" key={v}>
          {v}
        </span>
      ))}
      {p.unresolved ? (
        <span
          className="dep-ver dep-ver-none"
          title="the dependency graph listed this package but reported no version for it"
        >
          no version reported
        </span>
      ) : null}
      {p.conflict ? (
        <span
          className="dep-flag"
          data-flag="conflict"
          title="this repository resolved the package at two or more different versions in its own dependency tree"
        >
          conflict
        </span>
      ) : null}
    </div>
  );
}

function PackageRow({ p, shown }: { p: PackageEntry; shown: boolean }) {
  return (
    <tr className="dep-row" data-testid="dep-row" data-name={p.name} hidden={!shown}>
      <td className="dep-cell dep-cell-name">
        <span className="dep-name mono">{p.name}</span>
      </td>
      <td className="dep-cell">
        <Versions p={p} />
      </td>
      <td className="dep-cell">
        {p.dependents.length === 0 ? (
          <span className="dep-flag" data-flag="root" title="nothing in this repository’s graph depends on it">
            root · no dependents
          </span>
        ) : (
          <details className="dep-deps">
            <summary>
              <span className="dep-count num">{p.dependents.length}</span>
              {p.dependents.length === 1 ? ' dependent' : ' dependents'}
            </summary>
            <ul className="dep-list">
              {p.dependents.map((d) => (
                <li className="mono" key={d}>
                  {d}
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
    </tr>
  );
}

export function DependencyInventory({ inventory }: { inventory?: RepoInventory }) {
  // Enhancements ONLY — they narrow what is shown. Navigation is never React state (record 0057/D3).
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');

  const packages = inventory?.packages ?? [];

  // No graph for this repo — either the resolver never walked its tree, or the island predates the
  // field. Say WHICH kind of nothing this is: an empty table with no explanation reads as "this
  // repository has no dependencies", which is never true. (`graphed` is the stamped fact; it is not
  // `packages.length > 0`.)
  if (packages.length === 0) {
    return (
      <div className="card" data-testid="dep-inventory">
        <div className="card-head">
          <div>
            <h3>Dependencies</h3>
            <p className="card-sub">Every package this repository’s dependency graph observed.</p>
          </div>
        </div>
        <p className="empty" data-testid="dep-empty">
          No dependency graph was captured for this repository, so there is nothing to inventory. This
          is an absence of measurement — not a finding that the repository has no dependencies.
        </p>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = (p: PackageEntry) =>
    passes(p, filter) &&
    (!q || p.name.toLowerCase().includes(q) || p.dependents.some((d) => d.toLowerCase().includes(q)));

  const counts: Record<FilterId, number> = {
    all: packages.length,
    conflict: packages.filter((p) => p.conflict).length,
    unresolved: packages.filter((p) => p.unresolved).length,
    root: packages.filter((p) => p.root).length,
  };
  const shownCount = packages.filter(shown).length;

  return (
    <div className="card" data-testid="dep-inventory">
      <div className="card-head">
        <div>
          <h3>Dependencies</h3>
          <p className="card-sub">
            Every package this repository’s dependency graph resolved — the versions it was seen at,
            and what pulls it in.
          </p>
        </div>
      </div>

      <div className="dep-bar">
        <input
          className="dep-search"
          type="search"
          placeholder="Search packages or dependents"
          aria-label="search packages"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="dep-filters">
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f.id}
              className={f.id === filter ? 'dep-btn is-active' : 'dep-btn'}
              data-dep-filter={f.id}
              title={f.hint}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="dep-btn-n num">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="dep-scroll">
        <table className="dep-table">
          <thead>
            <tr>
              <th>Package</th>
              <th>Version(s)</th>
              <th>Dependents</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <PackageRow key={p.name} p={p} shown={shown(p)} />
            ))}
          </tbody>
        </table>
        <p className="dep-none" data-testid="dep-none" hidden={shownCount !== 0}>
          No package matches. Clear the search or reset the filter.
        </p>
      </div>

      <div className="card-foot">
        <p className="muted sm" data-testid="dep-foot">
          <span className="num">{shownCount}</span> of <span className="num">{packages.length}</span> packages
          resolved in this repository’s dependency graph.
        </p>
        <p className="muted sm">
          “No version reported” means the graph listed the package without a version — it is an
          unmeasured version, not a different one, and it never counts as a conflict. A conflict here is
          one this repository resolved two different ways in its own tree.
        </p>
      </div>
    </div>
  );
}
