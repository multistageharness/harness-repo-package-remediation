/**
 * Sample data for stories, tests, and the dev harness.
 *
 * Shaped after the renderer package's `test/fixtures/adversarial.mjs` — deliberately NOT
 * uniformly green. A green-only fixture is how three renderer defects survived 500+ passing
 * tests: every code path ran, and nothing a green run would contradict was ever asserted.
 */
import type { Repo } from '../../types';

const stages = (over: Partial<Record<string, string>> = {}) =>
  ['clone', 'fingerprint', 'plan', 'remediate', 'install', 'build', 'test', 'validate'].map((name) => ({
    name,
    status: (over[name] ?? 'ok') as Repo['stages'][number]['status'],
  }));

export const FIXED_REPO: Repo = {
  name: 'vuln-node-lodash',
  url: 'https://github.com/o/vuln-node-lodash',
  eco: 'node',
  outcome: 'fixed',
  skill: 'npm-remediation',
  vulns: [
    { cve: 'CVE-2021-23337', pkg: 'lodash', sev: 'high', from: '4.17.20', to: '4.17.21', scope: 'direct' },
    { cve: 'CVE-2021-44906', pkg: 'minimist', sev: 'critical', from: '1.2.5', to: '1.2.6', scope: 'transitive' },
  ],
  stages: stages(),
  snapshots: [
    { id: 's1', after: 'remediate', digest: 'sha256:8f14e45fceea167a', files: 42 },
    { id: 's2', after: 'build', digest: 'sha256:c9f0f895fb98ab91', files: 44 },
  ],
  logs: [
    { level: 'info', text: 'npm install — 312 packages in 4.2s' },
    { level: 'info', text: 'lodash 4.17.20 -> 4.17.21' },
    { level: 'warn', text: 'minimist pinned via overrides (transitive)' },
  ],
  deps: {
    nodes: ['app', 'lodash', 'minimist', 'express'],
    edges: [
      { from: 'app', to: 'lodash' },
      { from: 'app', to: 'express' },
      { from: 'express', to: 'minimist' },
    ],
  },
};

/** A repo whose build and test FAILED — the outcome chip must be red, not green. */
export const BROKEN_REPO: Repo = {
  name: 'vuln-python-urllib3',
  url: 'https://github.com/o/vuln-python-urllib3',
  eco: 'python',
  outcome: 'broken',
  skill: 'pip-remediation',
  vulns: [
    { cve: 'CVE-2023-45803', pkg: 'urllib3', sev: 'medium', from: '1.26.0', to: '2.0.7', scope: 'direct' },
  ],
  stages: stages({ build: 'failed', test: 'failed' }),
  snapshots: [{ id: 's1', after: 'remediate', digest: 'sha256:45c48cce2e2d7fbd', files: 18 }],
  logs: [
    { level: 'info', text: 'pip install -c constraints.txt' },
    { level: 'error', text: "ImportError: cannot import name 'Retry' from 'urllib3.util'" },
  ],
  deps: { nodes: ['app', 'urllib3', 'requests'], edges: [{ from: 'app', to: 'requests' }, { from: 'requests', to: 'urllib3' }] },
};

/** Blocked by a dead registry — must NOT depress the pass rate (record 0033). */
export const BLOCKED_REPO: Repo = {
  name: 'vuln-java-commons-text',
  url: 'https://github.com/o/vuln-java-commons-text',
  eco: 'java',
  outcome: 'blocked',
  skill: 'maven-remediation',
  vulns: [
    { cve: 'CVE-2022-42889', pkg: 'org.apache.commons:commons-text', sev: 'critical', from: '1.9', to: '1.10.0', scope: 'direct' },
  ],
  stages: stages({ install: 'failed', build: 'na', test: 'na', validate: 'blocked' }),
  snapshots: [],
  logs: [{ level: 'error', text: 'Could not reach repo.maven.apache.org — connection refused' }],
  deps: { nodes: [], edges: [] },
};

/** Declares no build script — `n/a` is NOT-APPLICABLE, not a pass (record 0042/A3). */
export const NA_BUILD_REPO: Repo = {
  name: 'vuln-node-tar',
  url: 'https://github.com/o/vuln-node-tar',
  eco: 'node',
  outcome: 'skipped',
  skill: 'npm-remediation',
  vulns: [{ cve: 'CVE-2021-37713', pkg: 'tar', sev: 'low', from: '6.1.0', to: '6.1.11', scope: 'transitive' }],
  stages: stages({ build: 'na', test: 'na' }),
  snapshots: [{ id: 's1', after: 'remediate', digest: 'sha256:d3d9446802a44259', files: 9 }],
  logs: [{ level: 'info', text: 'no build script declared — skipping' }],
  deps: { nodes: ['app', 'tar'], edges: [{ from: 'app', to: 'tar' }] },
};

/** The mixed run: the shape the pipeline really emits. */
export const SAMPLE_REPOS: Repo[] = [FIXED_REPO, BROKEN_REPO, BLOCKED_REPO, NA_BUILD_REPO];
