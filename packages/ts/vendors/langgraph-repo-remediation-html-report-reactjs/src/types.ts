/**
 * The organism's data contract.
 *
 * The source JSX carried a module-level `RAW` array (ten hardcoded repos) and derived
 * `REPOS` / `TOTALS` / `PASS_RATE` as module constants. All of it is lifted to props here
 * — the organism computes totals from `repos`, and the consumer owns the data.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Outcome = 'fixed' | 'broken' | 'blocked' | 'skipped' | 'bug';
export type StageStatus = 'ok' | 'failed' | 'blocked' | 'skipped' | 'na';
export type Ecosystem = 'node' | 'python' | 'java' | 'go' | 'ruby' | 'rust' | 'docker';

export interface Vulnerability {
  cve: string;
  pkg: string;
  sev: Severity;
  from: string;
  to: string;
  scope: 'direct' | 'transitive';
}

export interface Stage {
  name: string;
  status: StageStatus;
}

export interface Snapshot {
  id: string;
  after: string;
  digest: string;
  files: number;
}

export interface LogLine {
  level: 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface Repo {
  name: string;
  url: string;
  eco: Ecosystem;
  outcome: Outcome;
  vulns: Vulnerability[];
  stages: Stage[];
  snapshots: Snapshot[];
  logs: LogLine[];
  deps: { nodes: string[]; edges: DependencyEdge[] };
  skill?: string;
  tools?: string[];
}

/** Aggregate counts the header stats render. */
export interface Totals {
  fixed: number;
  broken: number;
  blocked: number;
  skipped: number;
  bug: number;
}
