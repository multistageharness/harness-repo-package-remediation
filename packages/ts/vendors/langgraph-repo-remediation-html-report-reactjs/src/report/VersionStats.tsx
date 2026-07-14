/**
 * VersionStats.tsx — the two roll-ups that sit beside "Advisories by severity": how BIG the run's
 * version moves were (semver totals), and HOW they were written (upgrade vs override).
 *
 * BOTH COUNT WRITTEN RECORDS, AND ONLY WRITTEN ONES. `changesOf` flattens `reps` — the remediation
 * RECORDS — and these two cards then keep the rows with `applied: true`. A planned-but-skipped row
 * has a bump level and a strategy just like a written one; counting it would make the run look like
 * it moved a version it never moved, which is record 0056/A1's defect wearing a bar chart. The
 * skipped rows are not swallowed either: they are named in each card's footnote and rendered in
 * full, with their reasons, by `VersionChanges` one card below.
 *
 * NEITHER CARD CLASSIFIES ANYTHING. `bump` is stamped by the data layer (`generator/src/bump.mjs`)
 * and `strategy` by the remediate atom that dispatched the write (`repo-remediate.mjs`). Both ride
 * into the page on the record. This file counts stamped facts; it does not parse a version and it
 * does not infer a mechanism from a tool name. A record with no `strategy` (an island emitted
 * before the atom's provenance reached the report) is counted as UNCLASSIFIED and said so — never
 * folded into `Upgraded`, whose count a reader would otherwise read as certain.
 */
import { bump, MECHANISMS, OFF_SEMVER_LEVELS, SEMVER_LEVELS } from './tokens';
import type { BumpLevel, RemediationStrategy, Repo } from './types';
import { type Change, changesOf } from './VersionChanges';

/** The rows both cards count: what the run actually wrote. */
export const written = (repos: Repo[]): Change[] => changesOf(repos).filter((c) => c.applied);

/** How many written moves of each size. Every level is a key, so a zero renders as a zero. */
export function bumpTotals(repos: Repo[]): Record<BumpLevel, number> {
  const totals: Record<BumpLevel, number> = { major: 0, minor: 0, patch: 0, downgrade: 0, same: 0, unknown: 0 };
  for (const c of written(repos)) totals[c.bump] += 1;
  return totals;
}

/** One bar of the semver chart — the same shape as the severity bars, colored by level. */
function BumpBar({ level, n, max }: { level: BumpLevel; n: number; max: number }) {
  return (
    <div className="sevbar" data-testid="semver-bar" data-bump={level}>
      <span className="sevbar-k">{level}</span>
      <div className="sevbar-track">
        <div className="sevbar-fill" style={{ width: `${(n / max) * 100}%`, background: bump(level) }} />
      </div>
      <span className="sevbar-n">{n}</span>
    </div>
  );
}

/**
 * Semantic-versioning totals: how many written moves were major, minor, patch.
 *
 * `downgrade` / `same` / `unknown` are charted only when the run produced one. They are not semver
 * sizes — three permanently-zero bars would be noise on every green run — but a run that DID
 * downgrade a package, or that moved a version no semver reading applies to (`1.2.3 → latest`, a
 * docker tag), must not have that fact quietly dropped from the chart that claims to total its
 * version moves.
 */
export function SemverTotals({ repos }: { repos: Repo[] }) {
  const totals = bumpTotals(repos);
  const rows = written(repos);
  const skipped = changesOf(repos).length - rows.length;
  const levels = [...SEMVER_LEVELS, ...OFF_SEMVER_LEVELS.filter((l) => totals[l] > 0)];
  const max = Math.max(...levels.map((l) => totals[l]), 1);

  return (
    <div className="card" data-testid="semver-totals">
      <div className="card-head">
        <div>
          <h3>Version moves by level</h3>
          <p className="card-sub">
            Semantic-versioning size of the {rows.length} change{rows.length === 1 ? '' : 's'} the run
            wrote.
          </p>
        </div>
      </div>
      <div className="sevbars">
        {levels.map((l) => (
          <BumpBar key={l} level={l} n={totals[l]} max={max} />
        ))}
      </div>
      {skipped > 0 && (
        <p className="vc-note" data-testid="semver-totals-note">
          {skipped} planned change{skipped === 1 ? '' : 's'} {skipped === 1 ? 'was' : 'were'} not written
          and {skipped === 1 ? 'is' : 'are'} excluded from these totals — a move that did not happen has
          no size. They are listed, with their reasons, under <strong>Version changes</strong>.
        </p>
      )}
    </div>
  );
}

/** The repos and packages behind one mechanism. */
interface Bucket {
  repos: string[];
  pkgs: number;
}

/** Split the written changes by mechanism: which repos were upgraded, which had an override applied. */
export function mechanismSplit(repos: Repo[]): {
  buckets: Record<RemediationStrategy, Bucket>;
  unclassified: number;
} {
  const buckets: Record<RemediationStrategy, Bucket> = {
    'direct-bump': { repos: [], pkgs: 0 },
    'transitive-pin': { repos: [], pkgs: 0 },
  };
  let unclassified = 0;

  for (const c of written(repos)) {
    if (c.strategy === undefined) {
      unclassified += 1;
      continue;
    }
    const b = buckets[c.strategy];
    b.pkgs += 1;
    // Repo order is the run's order and each repo lands at most once — deterministic by
    // construction, because a re-sorted list on hydration is a mismatch React will not warn about.
    if (!b.repos.includes(c.repo)) b.repos.push(c.repo);
  }
  return { buckets, unclassified };
}

/**
 * Upgrades vs overrides — WHICH repos were fixed by rewriting a version, and which by pinning a
 * transitive dependency the manifest never declared.
 *
 * The two buckets OVERLAP on purpose: a repo with a direct bump and a transitive pin appears in
 * both, because it really was both. Anything that partitions repos into one bucket each has to pick
 * a winner for that repo, and either pick is a lie about half its packages.
 */
export function UpgradeOverrideSplit({ repos }: { repos: Repo[] }) {
  const { buckets, unclassified } = mechanismSplit(repos);
  const both = buckets['direct-bump'].repos.filter((r) => buckets['transitive-pin'].repos.includes(r));

  return (
    <div className="card" data-testid="mechanism-split">
      <div className="card-head">
        <div>
          <h3>Upgrades vs overrides</h3>
          <p className="card-sub">
            How each fix reached the manifest — a direct version bump, or a pin for a transitive
            dependency the manifest never declared.
          </p>
        </div>
      </div>

      <div className="mech-split">
        {MECHANISMS.map(({ key, slug, label, hint }) => {
          const b = buckets[key];
          return (
            <div className="mech" key={key} data-testid="mechanism-bucket" data-mech={slug}>
              <div className="mech-n">{b.repos.length}</div>
              <div className="mech-label">
                {label}
                <span className="mech-sub">
                  {b.repos.length === 1 ? '1 repository' : `${b.repos.length} repositories`} · {b.pkgs}{' '}
                  package{b.pkgs === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mech-repos" title={hint}>
                {b.repos.length === 0 ? (
                  <span className="mech-none">none</span>
                ) : (
                  b.repos.map((r) => (
                    <span className="tag mono" key={r}>
                      {r}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(both.length > 0 || unclassified > 0) && (
        <p className="vc-note" data-testid="mechanism-split-note">
          {both.length > 0 && (
            <>
              {both.length} repositor{both.length === 1 ? 'y is' : 'ies are'} in both buckets — they were
              upgraded AND had an override applied: <span className="mono">{both.join(', ')}</span>.{' '}
            </>
          )}
          {unclassified > 0 && (
            <>
              {unclassified} written change{unclassified === 1 ? '' : 's'} carr{unclassified === 1 ? 'ies' : 'y'}{' '}
              no recorded mechanism and {unclassified === 1 ? 'is' : 'are'} counted in neither bucket.
            </>
          )}
        </p>
      )}
    </div>
  );
}
