/**
 * types.ts — the report's data contract (change record 0057/A4).
 *
 * This is the TypeScript mirror of what the generator's `buildReportData(channels, {keyOf})`
 * actually returns (`…-html-report-generator/src/data.mjs`). It is not a design; it is a
 * transcription. The generator gets the data from the pipeline's generated artifacts, serializes
 * it into the page as a JSON island, and this tree renders it.
 *
 * IT REPLACES THE OLD `src/types.ts`, WHICH WAS NOT THE CONTRACT. Record 0057/F3 found that the
 * previous hand-authored `Repo` could not express two of record 0056's three defect fixes:
 *
 *   - no `reps` field — so the "Applied changes" table could only render the PLAN, which is the
 *     exact defect 0056/A1 was filed to fix (it asserted work was done that was not done).
 *   - no `actionCount` — so the "Plan actions" tile could only echo the vulnerabilities tile,
 *     which is the exact defect 0056/A3 was filed to fix.
 *   - `outcome` was a scalar where the generator carries a per-repo `ledger` map, so the
 *     Outcome ledger card was inexpressible.
 *
 * A contract that cannot represent a fix cannot preserve it. Keep this file in lockstep with
 * `data.mjs`; the generator's `data.test.mjs` pins the shape from the other side.
 *
 * Note the vocabularies that DIVERGED before and are now reconciled (0057/F4): `Severity`
 * includes `'unknown'` (the generator has a defensive fallback and real payloads carry it — an
 * unknown severity used to produce a NaN comparator and an unstyled chip); the stage spine is the
 * generator's SIX stages, not eight; `Ecosystem` is the three the generator's token table knows,
 * plus `unknown`.
 */

/** Severity of an advisory. `unknown` is real — payloads carry it, so the UI must style it. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

/** Per-package outcome. This is the vocabulary the chip CSS colors. */
export type Outcome = 'fixed' | 'broken' | 'blocked' | 'skipped' | 'bug';

/**
 * A repo's overall VERDICT — a different vocabulary from `Outcome` (record 0056/A2). Only
 * `blocked` appears in both. Map it with `verdictChipKey` before using it as a chip key, or the
 * chip renders unstyled.
 */
export type Verdict = 'clean' | 'failed' | 'attention' | 'blocked' | 'noop' | 'n/a';

/** `na` = not-applicable / not-grounded — distinct from a real runtime `skipped` (record 0042/A3). */
export type StageStatus = 'ok' | 'failed' | 'blocked' | 'skipped' | 'na';

export type Ecosystem = 'node' | 'java' | 'python' | 'unknown';

/** One advisory, zipped with the plan action that addresses it. */
export interface Vulnerability {
  pkg: string;
  sev: Severity;
  cve: string;
  scope: 'direct' | 'transitive' | string;
  from: string;
  to: string;
  tool: string;
  action: string;
}

/**
 * How big a version move was. Classified in the DATA LAYER (`generator/src/bump.mjs`) from the
 * remediation's own real `from`/`to`, never in a component.
 *
 * `unknown` is not an error state — it is the honest answer for a move that has no semver reading
 * (`1.2.3 → latest`, a docker tag, a prerelease-only bump). The classifier never guesses, because a
 * fabricated level is one a reader would act on.
 */
export type BumpLevel = 'major' | 'minor' | 'patch' | 'downgrade' | 'same' | 'unknown';

/**
 * HOW a fix was written — the mechanism, not the size.
 *
 * `direct-bump` rewrites the package's own version where the manifest declares it (an UPGRADE).
 * `transitive-pin` cannot: the package is not a direct dependency, so the fix goes into the
 * ecosystem's override channel instead — npm `overrides`, pip `constraints.txt`, maven
 * `dependencyManagement` (an OVERRIDE). The remediate atom dispatches on this and stamps it onto
 * every record it writes; a record without it is an island emitted before the field existed.
 */
export type RemediationStrategy = 'direct-bump' | 'transitive-pin';

/**
 * A remediation RECORD — what the agent actually wrote to disk, as opposed to what the plan said
 * it would. `applied: false` with a real `skipReason` is the case record 0056/A1 exists to surface.
 */
export interface Remediation {
  package: string;
  applied: boolean;
  from?: string;
  to?: string;
  source?: string;
  skipReason?: string;
  /** Upgrade or override — see {@link RemediationStrategy}. Optional for pre-field islands. */
  strategy?: RemediationStrategy;
  /** The writer that performed it (`npm-overrides-pin`, `pip-requirement-bump`, …). */
  tool?: string;
  /** For a `transitive-pin`: the file the pin landed in (`package.json`, `pom.xml`, …). */
  pinnedIn?: string;
  /**
   * How big the move was. Named `bump`, not `level` — `level` already means a LOG SEVERITY in this
   * same payload (`LogLine.level`), and one field name with two meanings is how a renderer ends up
   * coloring a version bump with a log-level palette.
   *
   * OPTIONAL, and the optionality is the point: reports emitted before this field existed are still
   * on disk, and the dev harness renders them (`dev/sessions.mjs` backfills those islands with the
   * generator's own classifier). A page emitted today always carries it.
   */
  bump?: BumpLevel;
}

export interface Stage {
  name: string;
  status: StageStatus;
  duration: number;
}

/** One line of a unified diff: ` ` context, `-` removed, `+` added. */
export interface DiffLine {
  t: ' ' | '-' | '+';
  text: string;
}

export interface Snapshot {
  id: string;
  after: string;
  label: string;
  file: string;
  kind: 'diff' | 'digest';
  digest: string;
  changed: number;
  before?: string;
  next?: string;
  /** Precomputed in the data layer — the UI never computes a diff (0057/A2). */
  diff: DiffLine[];
}

export interface LogLine {
  t: string;
  stage: string;
  level: 'cmd' | 'ok' | 'info' | 'warn' | 'error';
  msg: string;
}

/** A node of the resolved dependency graph. `vuln` is `null` for a clean node, never absent. */
export interface GraphNode {
  id: string;
  name: string;
  version: string;
  depth: number;
  vuln: Vulnerability | null;
  isRoot: boolean;
}

/** The per-repo outcome ledger — a map of counts, not a scalar. */
export type Ledger = Record<Outcome, number>;

export interface RepoMeta {
  branch: string;
  commit: string;
  license: string;
  loc: number;
  manifest: string;
  lock: string;
  cloneMs: number;
  sizeKb: number;
  contributors: number;
  lastCommit: string;
}

export interface Repo {
  id: string;
  key: string;
  url: string;
  eco: Ecosystem;
  branch: string;
  license: string;
  loc: number;
  vulns: Vulnerability[];
  /** The plan's RAW action count — NOT `vulns.length` (record 0056/A3). */
  actionCount: number;
  /** The real remediation records (record 0056/A1). Empty for a dry/stub run. */
  reps: Remediation[];
  prompt: string;
  promptSource: string;
  skill: string;
  tools: string[];
  cloneError: string | null;
  overall: Verdict;
  outcomes: Ledger;
  ledger: Ledger;
  diagnoses: Array<Record<string, unknown>>;
  edges: Array<[string, string]>;
  stages: Stage[];
  snapshots: Snapshot[];
  manifest: { file: string; before: string; after: string };
  nodes: GraphNode[];
  /**
   * This repo's package inventory, rendered by its Dependencies tab. Derived from `nodes`/`edges`
   * in the data layer — the tab prints it and classifies nothing.
   *
   * OPTIONAL, and the optionality is the point: reports emitted while the inventory was still a
   * run-wide `ReportData.inventory` are still on disk, and the dev harness renders them
   * (`dev/sessions.mjs` backfills those islands with the generator's own builder, off the `nodes`
   * and `edges` they already carry). A page emitted today always carries it.
   */
  inventory?: RepoInventory;
  logs: LogLine[];
  meta: RepoMeta;
}

/** Run-wide aggregates. `actions` and `vulns` genuinely diverge (record 0056/A3). */
export interface Totals {
  repos: number;
  vulns: number;
  actions: number;
  fixed: number;
  broken: number;
  blocked: number;
  skipped: number;
  bug: number;
  sev: Partial<Record<Severity, number>>;
}

/**
 * The run's stamped environment fact (plan run-health-and-errors-log, Epic 03)
 * — `generator/src/data.mjs › deriveEnvironment` over the flow's
 * `service_health` channel. The banner renders ONLY from this; nothing here is
 * re-derived in a component (the data-contract rule).
 */
export interface EnvironmentFact {
  /** True when any probed service is down/unreachable. */
  degraded: boolean;
  /** Only the down/unreachable services — an empty list on a healthy run. */
  services: Array<{ id: string; status: string; detail: string; remedy: string | null }>;
  /** Deduplicated remedy sentences from the probes — the words a human acts on. */
  remedies: string[];
  /** Blocked outcomes in the run (totals.blocked). */
  blocked: number;
  /** broken + bug — the mixed-cause guard: a regression never hides behind Docker. */
  codeAttributable: number;
}

/**
 * One row of A REPO'S package inventory — a package as THAT REPO'S dependency graph observed it.
 * Stamped by `generator/src/data.mjs › buildRepoInventory`.
 *
 * The three states a version column can be in are DISTINCT, and collapsing any two of them is the
 * defect this shape exists to prevent:
 *
 *   - `versions: ['1.2.3']`                    — resolved, one version.
 *   - `versions: ['1.2.3'], unresolved: true`  — resolved in one place, UNMEASURED in another.
 *     NOT a conflict: the unmeasured one might well be `1.2.3` too.
 *   - `versions: ['1.2.3','2.0.0']`            — a real conflict. This, and only this, sets
 *     `conflict`.
 *
 * `conflict` IS SCOPED TO THE REPO — it means this repo's own graph resolved the package at two
 * versions (a diamond inside one tree), NOT that two different repos disagreed about it. The
 * inventory used to be a run-wide flatten, where it meant the latter; see `buildRepoInventory` for
 * why a per-repo table must never carry the run-wide answer.
 */
export interface PackageEntry {
  name: string;
  /** Distinct RESOLVED versions, sorted. Never contains a placeholder — see `unresolved`. */
  versions: string[];
  /** True when at least one observation carried no version at all (the resolver reported none). */
  unresolved: boolean;
  /** The parent node IDS that pull it in (`harness@0.0.0`), exactly as the resolver emitted them. */
  dependents: string[];
  /** `versions.length > 1` — two distinct RESOLVED versions. An unresolved observation never sets this. */
  conflict: boolean;
  /** Nothing depends on it — a graph root (the repo's own package). */
  root: boolean;
}

/**
 * One repo's package inventory, behind its Dependencies tab.
 *
 * `graphed` is load-bearing and is NOT `packages.length > 0`: it says whether the resolver walked
 * this repo's tree at all. A repo that produced no graph must read as "not measured" — an empty
 * table with no explanation reads as "this repo has no dependencies", which is never true.
 */
export interface RepoInventory {
  packages: PackageEntry[];
  graphed: boolean;
}

/** The whole contract — exactly what `buildReportData` returns and the JSON island carries. */
export interface ReportData {
  repos: Repo[];
  totals: Totals;
  /** fixed + broken + bug. Blocked and skipped are excluded (record 0033). */
  decided: number;
  /** `null` when nothing was decided — renders as `—`, never as 0%. */
  passRate: number | null;
  /** Row count of the ingested dataset. */
  rowsN: number;
  /**
   * The stamped environment fact behind the banner (run-health-and-errors-log
   * Epic 03). Optional: islands emitted before the field existed simply render
   * no banner.
   */
  environment?: EnvironmentFact;
}
