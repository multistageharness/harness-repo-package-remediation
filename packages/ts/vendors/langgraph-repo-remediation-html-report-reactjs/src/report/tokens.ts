/**
 * tokens.ts — the report's design + domain token tables.
 *
 * The TypeScript mirror of the generator's `src/tokens.mjs`. These two tables must agree: the
 * generator seeds severity colors into the SVG graph and the React tree colors everything else,
 * so a divergence shows up as two different reds on one page.
 */
import type {
  BumpLevel,
  Ecosystem,
  Outcome,
  RemediationStrategy,
  Severity,
  StageStatus,
  Verdict,
} from './types';

/** Rank drives severity sort order (critical first). `unknown` sorts last. */
export const SEV: Record<Severity, { hex: string; rank: number }> = {
  critical: { hex: '#e11d48', rank: 0 },
  high: { hex: '#f97316', rank: 1 },
  medium: { hex: '#f59e0b', rank: 2 },
  low: { hex: '#94a3b8', rank: 3 },
  unknown: { hex: '#94a3b8', rank: 4 },
};

/**
 * Severity lookup with a defensive fallback.
 *
 * Record 0057/F4: the old React contract's `Severity` union omitted `'unknown'`, so a payload
 * carrying it made `SEVERITY_RANK[a.sev]` `undefined` → a **NaN comparator** in the advisory sort,
 * and `styles[tone]` undefined → an unstyled chip. Never index the table directly.
 */
export const sev = (s: string | undefined | null): { hex: string; rank: number } =>
  SEV[s as Severity] ?? SEV.unknown;

/** The severity bars, in display order. `unknown` is deliberately not charted. */
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

/**
 * Bump-level colors — the SAME palette the `.chip-bump[data-bump=…]` rules already paint
 * (`report.css`), lifted here because a bar needs the hex inline (as `sevbar-fill` does) while a
 * chip gets it from CSS. One palette, two consumers: change both or neither.
 */
export const BUMP: Record<BumpLevel, string> = {
  major: '#be123c',
  minor: '#b45309',
  patch: '#047857',
  downgrade: '#6d28d9',
  same: '#64748b',
  unknown: '#94a3b8',
};

/** Never index `BUMP[…]` directly — an island from before `bump` existed carries `undefined`. */
export const bump = (b: string | undefined | null): string => BUMP[b as BumpLevel] ?? BUMP.unknown;

/**
 * The three levels that are ALWAYS charted, in semver order.
 *
 * `downgrade` / `same` / `unknown` are real (`bump.mjs` emits all three) but they are not semver
 * sizes, so they are charted only when a run actually produced one — see `SemverTotals`.
 */
export const SEMVER_LEVELS: BumpLevel[] = ['major', 'minor', 'patch'];
export const OFF_SEMVER_LEVELS: BumpLevel[] = ['downgrade', 'same', 'unknown'];

/** The two mechanisms, in display order, with the words a reader actually uses for them. */
export const MECHANISMS: Array<{
  key: RemediationStrategy;
  slug: 'upgrade' | 'override';
  label: string;
  hint: string;
}> = [
  {
    key: 'direct-bump',
    slug: 'upgrade',
    label: 'Upgraded',
    hint: 'the package’s own version was rewritten in the manifest',
  },
  {
    key: 'transitive-pin',
    slug: 'override',
    label: 'Override applied',
    hint: 'a transitive dependency, pinned through npm overrides / pip constraints / maven dependencyManagement',
  },
];

/** Outcome keys, in the order the ledger renders them. */
export const STATUS_ORDER: Outcome[] = ['fixed', 'broken', 'blocked', 'skipped', 'bug'];

export const OUTCOME: Record<Outcome, string> = {
  fixed: '#059669',
  broken: '#e11d48',
  blocked: '#d97706',
  skipped: '#64748b',
  bug: '#7c3aed',
};

export const ECO: Record<Ecosystem, { label: string; manifest: string; lock: string }> = {
  node: { label: 'node', manifest: 'package.json', lock: 'package-lock.json' },
  java: { label: 'java', manifest: 'pom.xml', lock: 'dependency-tree.txt' },
  python: { label: 'python', manifest: 'requirements.txt', lock: 'pip-freeze.txt' },
  unknown: { label: 'unknown', manifest: 'manifest', lock: 'lockfile' },
};

export const eco = (e: string | undefined | null) => ECO[e as Ecosystem] ?? ECO.unknown;

export const TOOLSETS: Record<Ecosystem, string[]> = {
  node: ['npm-audit-fix', 'npm-overrides-pin', 'npm-version-bump', 'manifest-edit'],
  java: ['gradle-version-bump', 'maven-dependency-pin', 'maven-version-bump', 'manifest-edit'],
  python: ['pip-constraints-pin', 'pip-requirement-bump', 'manifest-edit'],
  unknown: ['manifest-edit'],
};

/**
 * Map a repo's overall VERDICT to the outcome key the chip CSS actually colors (record 0056/A2).
 *
 * THE MAP IS NOT THE IDENTITY, and that is the whole trap. A repo's verdict vocabulary
 * (`clean`/`failed`/`attention`/`blocked`/`noop`) is NOT the per-package outcome vocabulary
 * (`fixed`/`broken`/`blocked`/`skipped`/`bug`) the chip CSS has rules for. Only `blocked` appears
 * in both. Passing a verdict straight through as a chip key — the obvious fix, and the one record
 * 0056/A2 literally proposed — emits `data-out="clean"` / `"failed"` / `"noop"`, none of which the
 * CSS colors: every one renders as an unstyled gray chip. That un-greens every clean repo AND
 * still fails to redden a failed one.
 *
 * An unrecognized verdict must never inherit green by accident, so the fallback is neutral gray.
 */
const VERDICT_CHIP: Record<string, Outcome> = {
  clean: 'fixed',
  failed: 'broken',
  attention: 'blocked',
  blocked: 'blocked',
  noop: 'skipped',
};

export const verdictChipKey = (overall: string | undefined | null): Outcome =>
  VERDICT_CHIP[overall as Verdict] ?? 'skipped';

/** `n/a` means "nothing to decide", which reads as clean — the one case key and text differ. */
export const overallChipOf = (overall: Verdict | string): { key: Outcome; text: string } =>
  overall === 'n/a' ? { key: 'fixed', text: 'clean' } : { key: verdictChipKey(overall), text: String(overall) };

/** Why a stage is not-applicable, keyed by the stage it sits on (record 0042/A3). */
export const RAIL_NA_HINT: Record<string, string> = {
  build: 'not applicable — no build script declared for this repository',
  test: 'not applicable — no test stage was grounded (stub, not exercised)',
  install: 'not applicable — install was not grounded (stub, not exercised)',
};

/**
 * The five stage statuses, in the order a health bar stacks them, with the palette the `.sdot`
 * rules in `report.css` already paint. Same rule as {@link BUMP}: a bar needs the hex inline while
 * a dot gets it from CSS — one palette, two consumers, change both or neither.
 *
 * The ORDER is load-bearing. Worst-first means the failing slice of a bar is always flush left,
 * where the eye lands, instead of hiding behind a long green run.
 */
export const STAGE_STATUS: Array<{ key: StageStatus; hex: string; label: string }> = [
  { key: 'failed', hex: '#f43f5e', label: 'failed' },
  { key: 'blocked', hex: '#f59e0b', label: 'blocked' },
  { key: 'ok', hex: '#10b981', label: 'passed' },
  { key: 'skipped', hex: '#cbd5e1', label: 'skipped' },
  { key: 'na', hex: '#f1f5f9', label: 'not applicable' },
];

/**
 * What each stage DOES, in words a reader who has never seen this harness can act on.
 *
 * The report's own stage names are the pipeline's internal vocabulary (`remediate`, `validate`) and
 * they are kept — an engineer reading a log needs the real name — but they lead with a plain verb
 * phrase, because "remediate: ok" tells a non-technical reader nothing about whether their
 * dependencies got fixed.
 *
 * Keyed by the stage name the generator stamps (`data.mjs` STAGE_NAMES). A stage with no entry here
 * still renders — it falls back to its raw name rather than vanishing, because a stage this table
 * has not caught up with is exactly the one worth seeing.
 */
export const STAGE_COPY: Record<string, { title: string; blurb: string }> = {
  clone: { title: 'Download the code', blurb: 'Fetch each repository from GitHub.' },
  fingerprint: {
    title: 'Identify the project',
    blurb: 'Detect the language and package manager from the manifest.',
  },
  plan: { title: 'Decide what to change', blurb: 'Work out which package versions need to move.' },
  remediate: {
    title: 'Apply the version changes',
    blurb: 'Write the new dependency versions into the project’s files.',
  },
  snapshot: { title: 'Record the before/after', blurb: 'Capture the files so the change can be diffed.' },
  install: {
    title: 'Re-install dependencies',
    blurb: 'Confirm the new versions actually resolve and install.',
  },
  'install-verify': {
    title: 'Confirm what installed',
    blurb: 'Check the version that resolved really is the fixed one.',
  },
  build: { title: 'Build the project', blurb: 'Compile it, to prove the change did not break it.' },
  test: { title: 'Run the project’s tests', blurb: 'Run the repository’s own test suite against the change.' },
  validate: {
    title: 'Check the fix landed',
    blurb: 'Verify each change satisfies the security advisory it was meant to fix.',
  },
};

export const stageCopy = (name: string): { title: string; blurb: string } =>
  STAGE_COPY[name] ?? { title: name, blurb: 'A pipeline stage.' };

/** Format a duration the way the generator does. */
export const ms = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`);
