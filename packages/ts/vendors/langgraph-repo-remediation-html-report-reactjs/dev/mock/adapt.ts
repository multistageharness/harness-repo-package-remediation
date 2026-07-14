/**
 * dev/mock/adapt.ts — real `ReportData` → the design mock's older `Repo[]` contract.
 *
 * The mock's examples are now fed from the SAME emitted session as the report (record 0058). They
 * cannot consume `ReportData` directly, because the mock predates it and has its own contract
 * (`src/types.ts`) — so this adapter is what the two data shapes cost.
 *
 * READ THE MAPPINGS BELOW AS A BUG REPORT, NOT AS PLUMBING. Every lossy line here is a place the mock
 * cannot express something the real report carries, and that gap is exactly how the two UIs drifted
 * apart in the first place (record 0057 found they had ended up with *disjoint* `data-testid`
 * vocabularies). Notably:
 *
 *   - `overall` is a VERDICT (`clean`/`failed`/`attention`/`blocked`/`noop`/`n/a`) and the mock's
 *     `outcome` is an OUTCOME (`fixed`/`broken`/`blocked`/`skipped`/`bug`). Two vocabularies, one
 *     overlapping member. Collapsing them is precisely the mistake record 0056/A2 was filed about,
 *     so the mapping is written out explicitly rather than assumed.
 *   - the report's per-repo `ledger` is a MAP of counts; the mock has a single scalar outcome, so
 *     a repo that half-fixed and half-blocked cannot be shown as such at all.
 *   - `severity: 'unknown'` and `eco: 'unknown'` are real values in payloads; the mock's unions
 *     have no member for either, so they are floored (and that flooring is a lie the real report
 *     does not tell).
 *
 * None of this is worth "fixing" in the mock — the mock does not ship. It is worth *knowing*.
 */
import type {
  Ecosystem as MockEco,
  LogLine as MockLog,
  Outcome as MockOutcome,
  Repo as MockRepo,
  Severity as MockSev,
  Snapshot as MockSnap,
} from '../../src/types';
import type { LogLine, Repo, ReportData, Severity, Verdict } from '../../src/report/types';

/** VERDICT → OUTCOME. Different vocabularies; only `blocked` is a member of both (record 0056/A2). */
const VERDICT_TO_OUTCOME: Record<Verdict, MockOutcome> = {
  clean: 'fixed',
  failed: 'broken',
  attention: 'bug',
  blocked: 'blocked',
  noop: 'skipped',
  'n/a': 'skipped',
};

/** The mock has no `unknown` severity; the report does, and payloads carry it. Floor it. */
function sev(s: Severity): MockSev {
  return s === 'unknown' ? 'low' : s;
}

/** The mock has no `unknown` ecosystem either. */
function eco(e: string): MockEco {
  return e === 'node' || e === 'python' || e === 'java' ? e : 'node';
}

/** The mock's log levels have no `cmd`/`ok`; map onto the nearest thing it can draw. */
function level(l: LogLine['level']): MockLog['level'] {
  if (l === 'cmd') return 'debug';
  if (l === 'ok') return 'info';
  return l;
}

function repo(r: Repo): MockRepo {
  return {
    name: r.key,
    url: r.url,
    eco: eco(r.eco),
    outcome: VERDICT_TO_OUTCOME[r.overall] ?? 'skipped',
    skill: r.skill,
    tools: r.tools,
    vulns: r.vulns.map((v) => ({
      cve: v.cve,
      pkg: v.pkg,
      sev: sev(v.sev),
      from: v.from,
      to: v.to,
      scope: v.scope === 'transitive' ? 'transitive' : 'direct',
    })),
    // The mock's stage has no duration — it draws a name and a status, nothing else.
    stages: r.stages.map((s) => ({ name: s.name, status: s.status })),
    snapshots: r.snapshots.map(
      (s): MockSnap => ({ id: s.id, after: s.after, digest: s.digest, files: s.changed }),
    ),
    logs: r.logs.map((l) => ({ level: level(l.level), text: `${l.stage}: ${l.msg}` })),
    deps: {
      nodes: r.nodes.map((n) => n.name),
      edges: r.edges.map(([from, to]) => ({ from, to })),
    },
  };
}

/** The mock's props, from a real (or variant-derived) run. */
export function toMockRepos(data: ReportData): MockRepo[] {
  return data.repos.map(repo);
}
