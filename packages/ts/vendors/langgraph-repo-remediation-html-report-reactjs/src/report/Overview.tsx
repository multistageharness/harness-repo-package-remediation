/**
 * Overview.tsx — the landing view: stat tiles, the run-results table, the pipeline, severity bars.
 *
 * PARITY NOTE (record 0057/Q2). The design-mock `parts/Overview.tsx` rendered FIVE stat tiles
 * (repos/fixed/broken/blocked/skipped) and no run-results table. The shipped report has NINE tiles
 * and the table is its primary surface. Three of the four missing tiles are not optional:
 * `vulnerabilities`, `actions`, and `passrate` are asserted directly by `behavior.test.mjs`, and
 * `actions` in particular IS record 0056/A3's fix.
 */
import { EcoChip, OverallChip, SevChip } from './chips';
import { PipelineHealth } from './PipelineHealth';
import { ms, sev } from './tokens';
import type { Repo, Totals } from './types';
import { VersionChanges } from './VersionChanges';
import { SemverTotals, UpgradeOverrideSplit } from './VersionStats';

/** Wall-clock for a repo = the sum of its stage durations. */
export const wall = (r: Repo): number => r.stages.reduce((a, s) => a + s.duration, 0);

/** The highest-severity advisory present, or `unknown` when there are none. */
export const topSev = (r: Repo): { sev: string } =>
  [...r.vulns].sort((a, b) => sev(a.sev).rank - sev(b.sev).rank)[0] ?? { sev: 'unknown' };

/**
 * The run-results columns, each with the sentence that explains it.
 *
 * The explanation is a PRERENDERED bubble (`.th-pop`) revealed by `:hover`/`:focus-visible` in CSS,
 * not a native `title`: `title` waits ~1s and cannot be styled. It is markup, not JS, so it survives
 * the no-JS invariant — and it is a real element, so a screen reader reads it (a `title` is announced
 * inconsistently at best).
 *
 * It costs one piece of CSS care, in `report.css`: `.table-scroll` is `overflow-x:auto`, which per
 * spec computes `overflow-y` to `auto` as well, so the bubble is clipped by the scroll box unless
 * there is room beneath the header. See the `.th-pop` block there for how the short-table and
 * `/empty` cases are handled — the bubble is not free of the container, it is fitted to it.
 *
 * Two of these sentences exist to head off a specific misreading:
 *   - ADVISORIES is the plan's INPUT (`vulns`), not the count of fixes written (`reps`) — the two
 *     lists are different, and conflating them is record 0056/A1's defect in reader form.
 *   - OUTCOME is the repo's VERDICT vocabulary (clean/failed/attention/blocked/noop), NOT the
 *     per-package outcome vocabulary (fixed/broken/…) the stat tiles count — record 0056/A2.
 */
const COLUMNS: ReadonlyArray<{ label: string; tip: string }> = [
  {
    label: 'Repository',
    tip: 'The cloned repository (owner/name). Select the row to open its logs, snapshots, and resolved dependency graph.',
  },
  {
    label: 'Environment',
    tip: 'The package ecosystem detected from the repository’s manifest — node, java, python, or unknown. It selects the toolchain the run used to install, build, and pin.',
  },
  {
    label: 'Advisories',
    tip: 'How many advisories the ingested dataset carries for this repository — what the run was ASKED to fix. It is not the number of fixes written; see “Applied changes”.',
  },
  {
    label: 'Top severity',
    tip: 'The highest severity among this repository’s advisories. Reads “unknown” when it carries none.',
  },
  {
    label: 'Stages',
    tip: 'One dot per pipeline stage, in run order; the colour is its status (ok, failed, blocked, skipped, or na = not applicable). Hover a dot for its stage name.',
  },
  { label: 'Run time', tip: 'Total time this repository spent in the pipeline — the sum of its stage durations.' },
  {
    label: 'Outcome',
    tip: 'The repository’s overall verdict: clean, failed, attention, blocked, or noop. This is a roll-up of the whole repo — a different vocabulary from the per-package outcomes (fixed/broken/blocked/skipped/bug) the tiles above count.',
  },
];

/**
 * What each tile COUNTS, in the vocabulary the pipeline actually stamps.
 *
 * Written for a reader who knows dependency management but not this harness. Each sentence names
 * the unit, then heads off the specific misreading that unit invites — because every one of these
 * numbers has been misread at least once, and two of them by us (records 0056/A1 and 0056/A3).
 *
 * The five outcome tiles (fixed/broken/blocked/skipped/bug) count REMEDIATION ATTEMPTS — one per
 * planned package, aggregated across repos — not repositories and not advisories. Their definitions
 * are the classifier's, verbatim in intent: `configs/patterns/remediation-validate.mjs` is the file
 * that assigns them, and the distinction it exists to defend is `broken` vs `blocked` — a down
 * registry or a pre-existing toolchain break is never a verdict on whether a dependency edit was
 * correct, so it must not read as `broken` and blame the remediation for a Docker outage.
 *
 * Keep these in sync with that classifier. A tile that explains itself wrongly is worse than one
 * that says nothing: the reader ACTS on it.
 */
const STAT_TIPS: Readonly<Record<string, string>> = {
  repos:
    'How many repositories the run cloned and drove through the pipeline. Every other tile on this row aggregates across exactly this set.',
  vulnerabilities:
    'Advisories the ingested dataset carries across all repositories — the run’s INPUT, what it was asked to fix. This is not the number of fixes written; for that, read “Fixed”.',
  actions:
    'Version changes the generated plans intended to write. It can legitimately exceed the advisory count: a package-rule pin is an action with no advisory behind it, so the two numbers are not the same list and are not expected to match.',
  passrate:
    'fixed ÷ (fixed + broken + bug) — decided attempts only. Blocked and skipped are deliberately kept out of the denominator, so a down package registry or a benign no-op can never depress the remediation score. Reads “—”, never 0%, when nothing was decided.',
  fixed:
    'Remediation attempts that were applied AND confirmed: the version that actually resolved satisfies the advisory’s first-patched floor, and no downstream stage failed in a way attributable to the edit.',
  broken:
    'Applied edits the run blames for a downstream failure — the first failing stage’s cause points back at the bumped package, typically a dependency or peer conflict naming it. This is the genuine-regression bucket, and the only failure bucket that counts against the pass rate.',
  blocked:
    'Not a verdict on the edit. Either the attempt never ran for an external reason (clone failed, no bump support for the ecosystem, a policy denial), or it was applied and the only downstream failure has a benign cause — a down package registry, a pre-existing toolchain break. Excluded from the pass rate for exactly that reason.',
  skipped:
    'Benign no-ops. The dependency was already at or above the target, no newer version exists, the dataset cell was blank, or the manifest syntax is unsupported. Nothing was written, and nothing was wrong.',
  bug: 'Unexpected failures the harness owns rather than the dependency edit: a manifest edit that failed to write, or a downstream stage that failed in a repository where no remediation was ever applied — a pre-existing break the run surfaced rather than caused.',
};

/**
 * One stat tile.
 *
 * The `data-testid="stat-<id>"` attribute is a CONTRACT, not a convenience: `behavior.test.mjs`
 * and the pack's remediation00{2,3}-matrix tests regex it out of the emitted HTML. Note there is no
 * whitespace between this element and its `.stat-value` child — the matrix regex
 * (`data-testid="stat-x"[^>]*><div class="stat-value">`) depends on that. That is also why the info
 * badge hangs off the LABEL and not the value: putting anything between the tile and `.stat-value`
 * silently breaks a test in another package.
 *
 * The explanation is the same prerendered `:hover`/`:focus-visible` bubble the table headers use
 * (`.th-pop`), under its own class names. Sharing one rule block but two names is deliberate: the
 * report's own test pins `class="th-i"` to exactly one per column, so reusing that class here would
 * fail it for a reason that has nothing to do with the table.
 */
function StatTile({
  id,
  label,
  value,
  cls = '',
  emphasis = false,
}: {
  id: string;
  label: string;
  value: string | number;
  cls?: string;
  emphasis?: boolean;
}) {
  const tip = STAT_TIPS[id];
  return (
    <div className={`stat ${cls}${emphasis ? ' stat-em' : ''}`} data-testid={`stat-${id}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip IS the interaction. */}
        <span className="stat-tip" tabIndex={0}>
          {label}
          <i className="stat-i" aria-hidden="true">
            i
          </i>
          <span className="stat-pop" role="tooltip">
            {tip}
          </span>
        </span>
      </div>
    </div>
  );
}

export function Overview({
  repos,
  totals,
  decided,
  passRate,
  rowsN,
  onOpenRepo,
}: {
  repos: Repo[];
  totals: Totals;
  decided: number;
  passRate: number | null;
  rowsN: number;
  onOpenRepo: (idx: number) => void;
}) {
  const sorted = [...repos].sort((a, b) => sev(topSev(a).sev).rank - sev(topSev(b).sev).rank);
  const maxSev = Math.max(...(['critical', 'high', 'medium', 'low'] as const).map((s) => totals.sev[s] || 0), 1);

  return (
    <div className="stack">
      <div className="stat-grid">
        <StatTile id="repos" label="Repositories" value={totals.repos} />
        <StatTile id="vulnerabilities" label="Vulnerabilities" value={totals.vulns} />
        {/* 0056/A3: counts ACTIONS, not vulnerabilities. It used to read `vulns.length` — the same
            value as the tile beside it, guaranteed identical for every run, which is why the
            duplication never looked wrong. A package-rule pin is an action with no advisory. */}
        <StatTile id="actions" label="Plan actions" value={totals.actions} />
        <StatTile
          id="passrate"
          label="Pass rate"
          value={passRate === null ? '—' : `${passRate}%`}
          cls="s-fixed"
          emphasis
        />
        <StatTile id="fixed" label="Fixed" value={totals.fixed} cls="s-fixed" />
        <StatTile id="broken" label="Broken" value={totals.broken} cls={totals.broken ? 's-broken' : 's-zero'} />
        <StatTile id="blocked" label="Blocked" value={totals.blocked} cls={totals.blocked ? 's-blocked' : 's-zero'} />
        <StatTile id="skipped" label="Skipped" value={totals.skipped} cls={totals.skipped ? 's-skipped' : 's-zero'} />
        <StatTile id="bug" label="Bug" value={totals.bug} cls={totals.bug ? 's-bug' : 's-zero'} />
      </div>

      <p className="passrate-note" data-testid="passrate-note">
        Pass rate = fixed ÷ (fixed + broken + bug) = {totals.fixed} ÷ {decided}
        {passRate === null ? '' : ` = ${passRate}%`} — decided outcomes only. <strong>Blocked</strong>{' '}
        (environment or pre-existing) and <strong>skipped</strong> (benign no-op) are excluded, so a down
        registry never depresses the remediation score.
      </p>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Run results</h3>
            <p className="card-sub">
              Sorted by highest severity present. Select a row to inspect logs, snapshots, and the resolved
              graph. Hover a column header for what it means.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.label} data-testid={`col-${c.label.toLowerCase().replace(' ', '-')}`}>
                    {/* tabIndex makes the explanation reachable without a mouse — the CSS reveals the
                        bubble on :focus-visible exactly as it does on :hover. */}
                    {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip IS the interaction. */}
                    <span className="th-tip" tabIndex={0}>
                      {c.label}
                      {/* The badge advertises that an explanation exists; the bubble IS the
                          explanation. `aria-hidden` on the badge: a screen reader that reaches the
                          bubble text gains nothing from also hearing a bare "i". */}
                      <i className="th-i" aria-hidden="true">
                        i
                      </i>
                      <span className="th-pop" role="tooltip">
                        {c.tip}
                      </span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const idx = repos.indexOf(r);
                return (
                  // A table row cannot be a <label>, so this one enhancement is genuinely JS-only:
                  // the click flips the view + repo radios. With JS off the row is inert, and the
                  // sidebar (which IS <label>-driven) remains the way to reach the repo.
                  <tr
                    key={r.id}
                    className="row-link"
                    data-open-idx={idx}
                    onClick={() => onOpenRepo(idx)}
                  >
                    <td className="strong">{r.key}</td>
                    <td>
                      <EcoChip e={r.eco} />
                    </td>
                    <td className="num">{r.vulns.length}</td>
                    <td>
                      <SevChip s={topSev(r).sev} />
                    </td>
                    <td>
                      <div className="dots">
                        {r.stages.map((s) => (
                          <span key={s.name} className="sdot" data-status={s.status} title={`${s.name}: ${s.status}`} />
                        ))}
                      </div>
                    </td>
                    <td className="num muted">{ms(wall(r))}</td>
                    <td>
                      <OverallChip overall={r.overall} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full width, and it earns it: each stage is a row with a bar, not a command string.
          REPLACES the old hardcoded nine-string "Pipeline" list, which rendered identically whether
          the run passed or failed — see PipelineHealth.tsx's header for why that was the defect. */}
      <PipelineHealth repos={repos} rowsN={rowsN} />

      {/* The two bar charts, now paired with each other: the advisories the run was ASKED to fix, and
          the size of the moves it actually WROTE. Same visual language, input beside output — which is
          a more honest pairing than either had before, and it is what widening the other two frees up. */}
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Advisories by severity</h3>
            </div>
          </div>
          <div className="sevbars">
            {(['critical', 'high', 'medium', 'low'] as const).map((s) => {
              const n = totals.sev[s] || 0;
              return (
                <div className="sevbar" key={s}>
                  <span className="sevbar-k">{s}</span>
                  <div className="sevbar-track">
                    <div className="sevbar-fill" style={{ width: `${(n / maxSev) * 100}%`, background: sev(s).hex }} />
                  </div>
                  <span className="sevbar-n">{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        <SemverTotals repos={repos} />
      </div>

      {/* Full width. Its two buckets are a grid too, and the repo tags inside them wrap hard at half
          width — this is the card that most wanted the room. */}
      <UpgradeOverrideSplit repos={repos} />

      {/* Last on the overview, deliberately: the tiles say how the run SCORED, this says what it
          actually CHANGED — the detail a reader reaches for once the score has landed. */}
      <VersionChanges repos={repos} />
    </div>
  );
}
