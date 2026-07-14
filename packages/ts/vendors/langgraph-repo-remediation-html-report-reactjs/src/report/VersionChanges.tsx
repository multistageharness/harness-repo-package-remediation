/**
 * VersionChanges.tsx — every version the run actually moved, across every repo, in one table.
 *
 * IT RENDERS `reps`, NOT `vulns`, AND THAT IS THE WHOLE DESIGN. `reps` are the remediation RECORDS —
 * what the agent wrote to disk. `vulns` are the PLAN — what it intended to write. The two look
 * interchangeable (both carry a `pkg`, a `from`, and a `to`) and they are not: a plan row exists for
 * work that was never done. Rendering the plan under a heading that says "changes" is precisely the
 * defect record 0056/A1 was filed to fix, in the table one screen below this one. This section is a
 * second, larger surface for the same mistake, so it takes the same care:
 *
 *   - rows come from `r.reps` — the records;
 *   - a record with `applied: false` renders as NOT applied, with its `skipReason`, rather than
 *     being dropped (a silently missing row reads as "nothing to do here", which is a different
 *     claim than "we tried and stopped");
 *   - a repo with no records at all is COUNTED and named in the footer, never omitted — an empty
 *     table with no explanation is indistinguishable from a table that failed to render.
 *
 * The level chip comes from the DATA (`Remediation.bump`, stamped by `generator/src/bump.mjs`).
 * This component does not classify versions; it does not parse them; it prints what it was given.
 * `?? 'unknown'` is a floor for islands emitted before the field existed — not a fallback that
 * invents a level (see `types.ts`, and `dev/sessions.mjs` for how old islands are backfilled).
 */
import type { BumpLevel, RemediationStrategy, Repo } from './types';

/** One row: a package whose version the run moved (or tried to). */
export interface Change {
  repo: string;
  pkg: string;
  from: string;
  to: string;
  bump: BumpLevel;
  /**
   * HOW it was written — an upgrade or an override. Undefined (not guessed) for an island emitted
   * before the remediate atom's provenance rode into the report; `VersionStats` counts those as
   * unclassified rather than folding them into either bucket.
   */
  strategy?: RemediationStrategy;
  applied: boolean;
  skipReason?: string;
}

/**
 * Flatten the run into one row per remediation record, repo order preserved.
 *
 * Deterministic by construction — no sort, no clock, no hash. Reordering rows on every render is a
 * hydration mismatch, and a production React build does not warn about those (invariant ③).
 */
export function changesOf(repos: Repo[]): Change[] {
  const rows: Change[] = [];
  for (const r of repos) {
    for (const rep of r.reps) {
      rows.push({
        repo: r.key,
        pkg: rep.package,
        from: rep.from ?? '?',
        to: rep.to ?? '?',
        bump: rep.bump ?? 'unknown',
        strategy: rep.strategy,
        applied: rep.applied,
        skipReason: rep.skipReason,
      });
    }
  }
  return rows;
}

/** The chip whose COLOR is driven by `data-bump` — the CSS colors off the attribute, not the text. */
export const BumpChip = ({ level }: { level: BumpLevel }) => (
  <span className="chip chip-bump" data-bump={level}>
    {level}
  </span>
);

export function VersionChanges({ repos }: { repos: Repo[] }) {
  const rows = changesOf(repos);
  const silent = repos.filter((r) => r.reps.length === 0);
  const applied = rows.filter((r) => r.applied).length;

  return (
    <div className="card" data-testid="version-changes">
      <div className="card-head">
        <div>
          <h3>Version changes</h3>
          <p className="card-sub">
            What the remediation <strong>wrote</strong> — one row per remediation record, not per planned
            action. {applied} of {rows.length} written across {repos.length - silent.length} of {repos.length}{' '}
            repositories.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="vc-empty" data-testid="version-changes-empty">
          No version changes were written. Nothing reached the manifests in this run — the plan, if there
          was one, is in each repository's own view.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                {['Repository', 'Package', 'Change', 'Level', 'Written'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={`${c.repo}/${c.pkg}/${c.from}/${c.to}`} data-testid="version-change-row">
                  <td className="strong">{c.repo}</td>
                  <td className="mono">{c.pkg}</td>
                  <td className="vc-move mono">
                    <span className="vc-from">{c.from}</span>
                    <span className="vc-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="vc-to">{c.to}</span>
                  </td>
                  <td>
                    <BumpChip level={c.bump} />
                  </td>
                  <td>
                    {c.applied ? (
                      <span className="chip chip-out" data-out="fixed">
                        applied
                      </span>
                    ) : (
                      // 0056/A1 again: a record that was NOT applied says so, and says why. This is
                      // the row that a plan-shaped table structurally cannot show.
                      <span className="chip chip-out" data-out="skipped" title={c.skipReason ?? 'no reason recorded'}>
                        not applied
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {silent.length > 0 && (
        <p className="vc-note" data-testid="version-changes-note">
          {silent.length} of {repos.length} repositories wrote no changes:{' '}
          <span className="mono">{silent.map((r) => r.key).join(', ')}</span>. A repository with no
          remediation records is not a repository with nothing wrong — a blocked run produces exactly
          this.
        </p>
      )}
    </div>
  );
}
