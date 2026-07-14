/**
 * dev/variants.ts — ONE dataset, several shapes of run.
 *
 * Every example on both dev pages is now derived from the SAME data: the `ReportData` of a report
 * the flow actually emitted (`dev/sessions.mjs` reads it out of the page's JSON island). The
 * variants below are pure `ReportData → ReportData` transforms that turn that one real run into the
 * other runs a reader will eventually get — an empty ingest, a wholly blocked run.
 *
 * WHY NOT FIXTURES. The examples used to be four hand-written datasets that no pipeline ever
 * produced. That is not a smaller version of the real thing, it is a *different* thing: the fixtures
 * had their own field names, their own vocabularies, and their own idea of what a repo looks like —
 * and every one of those divergences is a bug the dev harness cannot show you. Deriving each variant
 * from real data means an example can only be wrong in ways the real report can also be wrong.
 *
 * WHY TRANSFORMS AND NOT MORE CAPTURED RUNS. A blocked run is not lying around on disk when you need
 * one, and waiting for the pipeline to produce one is not a dev loop. A transform gives you the state
 * on demand *from data that is real*, and — because totals are RECOMPUTED, never hand-written — the
 * derived run is internally consistent the way a captured one is.
 *
 * The totals rules encoded in `recount` are the report's, not this file's invention:
 *   - `decided` = fixed + broken + bug. Blocked and skipped are EXCLUDED (record 0033).
 *   - `passRate` is `null` when nothing was decided — it renders as an em-dash, never as `0%`.
 *     A wholly blocked run scoring 0% is exactly the false verdict record 0033 fixed.
 */
import type { Ledger, Outcome, ReportData, Repo, Severity, StageStatus } from '../src/report/types';

/** Rebuild every aggregate from the repos, so a derived run is as self-consistent as a real one. */
export function recount(repos: Repo[], rowsN: number): ReportData {
  const sev: Partial<Record<Severity, number>> = {};
  const led: Ledger = { fixed: 0, broken: 0, blocked: 0, skipped: 0, bug: 0 };
  let vulns = 0;
  let actions = 0;

  for (const r of repos) {
    vulns += r.vulns.length;
    actions += r.actionCount;
    for (const v of r.vulns) sev[v.sev] = (sev[v.sev] ?? 0) + 1;
    for (const k of Object.keys(led) as Outcome[]) led[k] += r.ledger[k] ?? 0;
  }

  const decided = led.fixed + led.broken + led.bug;
  return {
    repos,
    totals: { repos: repos.length, vulns, actions, ...led, sev },
    decided,
    // `null`, not 0 — see the header note.
    passRate: decided === 0 ? null : Math.round((led.fixed / decided) * 100),
    rowsN,
  };
}

/** Everything a remediation could not reach once the run was blocked. */
const BLOCKED_FROM = new Set(['remediate', 'install', 'install-verify', 'build', 'test', 'validate']);

/**
 * The run as it happened, with every package outcome turned to `blocked`.
 *
 * Blocked is the state a dead registry produces (record 0054) — the most common non-green run there
 * is, and the one whose scoring is easiest to get wrong. The stages that could still complete
 * (clone, fingerprint, plan) stay `ok`: a blocked run is not a run where nothing happened.
 */
function blockAll(data: ReportData): ReportData {
  const repos = data.repos.map((r): Repo => {
    const n = Math.max(1, r.vulns.length);
    const ledger: Ledger = { fixed: 0, broken: 0, blocked: n, skipped: 0, bug: 0 };
    return {
      ...r,
      overall: 'blocked',
      outcomes: ledger,
      ledger,
      stages: r.stages.map((s) => (BLOCKED_FROM.has(s.name) ? { ...s, status: 'blocked' as StageStatus } : s)),
      // The plan still exists — nothing was applied from it. That distinction is the whole point of
      // the `reps`-vs-plan split (record 0056/A1), so a blocked run must show it.
      reps: [],
    };
  });
  return recount(repos, data.rowsN);
}

/** A run that ingested nothing. `rowsN` stays — the dataset was read, it just had no rows for us. */
function emptyRun(data: ReportData): ReportData {
  return recount([], data.rowsN);
}

export interface Variant {
  id: string;
  label: string;
  /** What a reader is looking at, said plainly — the dev pages show this. */
  note: string;
  apply: (data: ReportData) => ReportData;
}

export const VARIANTS: Variant[] = [
  { id: 'as-run', label: 'as run', note: 'the session exactly as the flow emitted it', apply: (d) => d },
  {
    id: 'blocked',
    label: 'all blocked',
    note: 'same repos, every outcome blocked — pass rate is an em-dash, not 0%',
    apply: blockAll,
  },
  { id: 'empty', label: 'empty run', note: 'the same dataset ingested zero repositories', apply: emptyRun },
];

export const DEFAULT_VARIANT = VARIANTS[0].id;

export function variant(id: string): Variant {
  return VARIANTS.find((v) => v.id === id) ?? VARIANTS[0];
}
