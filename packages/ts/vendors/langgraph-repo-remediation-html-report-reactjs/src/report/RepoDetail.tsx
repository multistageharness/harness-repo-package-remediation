/**
 * RepoDetail.tsx — one repository's card: header, snapshot rail + diff, and three tabs.
 *
 * PARITY (record 0057/Q2). Two of the surfaces here are record 0056's defect fixes and are NOT
 * droppable — the Applied-changes table (0056/A1) and the Outcome ledger (in the header + the side
 * rail). `behavior.test.mjs` fails without them.
 *
 * The tabs are plan / deps / logs / meta.
 *
 * THE `deps` TAB IS THE PACKAGE INVENTORY, AND IT HAS BEEN HERE TWICE. It began as a `graph` tab
 * holding a per-repo SVG of the resolved dependency graph; that was dropped for a top-level,
 * run-wide `DependencyInventory` VIEW (the cross-repo questions — which packages does the run share,
 * where do the versions disagree — were judged the ones a reader has). It is now back in the card,
 * as a table rather than an SVG, because the question a reader actually has WHILE LOOKING AT A
 * REPOSITORY is what THAT repository depends on.
 *
 * The move rescoped one fact and the rescoping is not cosmetic: `conflict` now means "this repo
 * resolved the package at two versions in its own tree", not "two repos disagreed". See
 * `DependencyInventory.tsx` and `data.mjs › buildRepoInventory` — a per-repo table must never carry
 * the run-wide answer.
 *
 * TABS ARE RADIO-DRIVEN (record 0057/D3), not `useState`. Every tab panel is in the markup and CSS
 * decides which is visible, so the whole card is readable with JS off — and, just as importantly,
 * so `behavior.test.mjs` can slice this card out of the emitted HTML and find the Applied-changes
 * table inside it without running a browser.
 */
import { Fragment, useState } from 'react';

import { EcoChip, OutChip, OverallChip, SevChip, SevDot } from './chips';
import { DependencyInventory } from './DependencyInventory';
import { withKeys } from './keys';
import { Logs } from './Logs';
import { topSev, wall } from './Overview';
import { eco, ms, RAIL_NA_HINT, STATUS_ORDER, TOOLSETS } from './tokens';
import type { Repo, Snapshot } from './types';

/** Keep in lockstep with `navCss.ts`'s `TABS` — a tab missing there renders but can never be shown. */
const TABS = ['plan', 'deps', 'logs', 'meta'] as const;

const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  plan: 'Plan & advisories',
  deps: 'Dependencies',
  logs: 'Logs',
  meta: 'Metadata',
};

/** The snapshot the rail opens on, and the only one whose panel is visible before hydration. */
const DEFAULT_SNAP = 'post-remediate';

function MetaRow({ k, v, mono = false }: { k: string; v: string | number; mono?: boolean }) {
  return (
    <div className="meta-row">
      <dt>{k}</dt>
      <dd className={mono ? 'mono' : ''}>{v}</dd>
    </div>
  );
}

/**
 * The "Applied changes" table — record 0056/A1's fix.
 *
 * It renders the REMEDIATIONS: what the agent actually wrote to disk. The defect this replaces
 * iterated the PLAN (`repo.vulns`) and hardcoded every row as `Applied: yes / Source: dataset /
 * Skip reason: —`, while the real records sat joined-and-unread on `repo.reps`. It asserted work
 * was done that was not done. Record 0019/A3 committed to "every skip is recorded, never dropped";
 * the JSON report and decision.jsonl honored that, and the HTML — the artifact a human actually
 * reads — silently did not.
 *
 * The `repo.vulns` fallback is retained for runs that produced NO remediation records (a dry/stub
 * run): those rendered the plan before, and still do. That fallback is what keeps this a fix rather
 * than a regression for stub runs.
 */
function AppliedChanges({ repo }: { repo: Repo }) {
  const usingReps = repo.reps.length > 0;
  const rows: Array<Record<string, unknown>> = usingReps
    ? (repo.reps as unknown as Array<Record<string, unknown>>)
    : (repo.vulns as unknown as Array<Record<string, unknown>>);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Applied changes</h3>
          <p className="card-sub">What the agent wrote to disk, reconciled against the plan.</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              {['Package', 'Applied', 'From', 'To', 'Source', 'Skip reason'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  no changes
                </td>
              </tr>
            ) : (
              withKeys(rows, (x) => String(usingReps ? x.package : x.pkg)).map(({ item: x, key }) => {
                // A remediation record carries `package`/`applied`/`skipReason`/`source`; a plan vuln
                // carries `pkg` and none of the rest. Normalize, then render the REAL fields.
                const pkg = String(usingReps ? x.package : x.pkg);
                const applied = usingReps ? x.applied === true : true;
                const source = usingReps ? (x.source as string) ?? '—' : 'dataset';
                const skipReason = usingReps ? (x.skipReason as string) ?? '—' : '—';
                return (
                  <tr key={key}>
                    <td className="mono">{pkg}</td>
                    <td>
                      <OutChip k={applied ? 'fixed' : 'skipped'} text={applied ? 'yes' : 'no'} />
                    </td>
                    <td className="mono muted">{x.from as string}</td>
                    <td className="mono strong">{x.to as string}</td>
                    <td className="muted">{source}</td>
                    <td className="muted">{skipReason}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The stage rail — one node per stage, with the snapshot digests hung on the connectors. */
function SnapshotRail({
  repo,
  active,
  onPick,
}: {
  repo: Repo;
  active: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="rail" data-repo-id={repo.id} data-active-snap={active}>
      {repo.stages.map((s, i) => {
        const snap = repo.snapshots.find((sn) => sn.after === s.name);
        // 0042/A3: `na` (not-applicable / not-grounded) is its own dashed state, visually and
        // semantically distinct from `skip` (a deliberate runtime no-op), `fail`, and `ok`. Before
        // that record an ungrounded stage rendered as a GREEN dot — the rail implied a repo had
        // passed a stage it never ran, or had a `build` it declares no script for.
        const dotCls =
          s.status === 'ok'
            ? 'ok'
            : s.status === 'skipped'
              ? 'skip'
              : s.status === 'failed'
                ? 'fail'
                : s.status === 'na'
                  ? 'na'
                  : 'muted';
        const title = s.status === 'na' ? RAIL_NA_HINT[s.name] ?? 'not applicable' : `${s.name}: ${s.status}`;
        return (
          <Fragment key={s.name}>
            <div className="rail-step">
              <div className={`rail-node ${dotCls}`} title={title}>
                {i + 1}
              </div>
              <div className="rail-name">{s.name}</div>
              <div className="rail-dur">{s.status === 'na' ? 'n/a' : ms(s.duration)}</div>
            </div>
            {i < repo.stages.length - 1 ? (
              <div className="rail-conn">
                {snap ? (
                  <>
                    <button
                      type="button"
                      className={snap.id === active ? 'rail-snap is-active' : 'rail-snap'}
                      data-snap={snap.id}
                      data-repo-id={repo.id}
                      title={`${snap.label} — ${snap.file}`}
                      onClick={() => onPick(snap.id)}
                    >
                      {snap.digest.slice(0, 7)}
                    </button>
                    <span className="rail-snap-label">{snap.label.toLowerCase()}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/** One snapshot's body: a text diff, or a note that a digest-only snapshot has none to show. */
function SnapshotBody({ snap }: { snap: Snapshot }) {
  if (snap.kind === 'digest') {
    return (
      <div className="snap-empty">
        Content-addressed only. This snapshot records the resolved state of <code>{snap.file}</code> so a later
        stage can prove nothing drifted — there is no text diff to render.
      </div>
    );
  }
  if (snap.diff.every((x) => x.t === ' ')) {
    return <div className="snap-empty">Baseline. Nothing has changed yet.</div>;
  }
  return (
    <div className="diff">
      <pre>
        {withKeys(snap.diff, (x) => `${x.t}|${x.text}`).map(({ item: x, key }) => (
          <div key={key} className={`dl dl-${x.t === '+' ? 'add' : x.t === '-' ? 'del' : 'ctx'}`}>
            <span className="dl-g">{x.t === ' ' ? ' ' : x.t}</span>
            {x.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Every snapshot panel is rendered; the picker only toggles which is visible. */
function SnapshotDetails({ repo, active }: { repo: Repo; active: string }) {
  return (
    <div className="snap-details" data-repo-id={repo.id}>
      {repo.snapshots.map((snap) => (
        <div
          key={snap.id}
          className={snap.id === active ? 'snap-detail is-active' : 'snap-detail'}
          data-snap={snap.id}
          hidden={snap.id !== active}
        >
          <div className="snap-meta">
            <span className="chip chip-snap">{snap.label}</span>
            <code className="tag">{snap.file}</code>
            <span className="mono muted sm">sha256:{snap.digest}</span>
            <span className="snap-changed">
              {snap.changed} file{snap.changed === 1 ? '' : 's'} changed
            </span>
          </div>
          <SnapshotBody snap={snap} />
        </div>
      ))}
    </div>
  );
}

/** The LLM-authored prompt. Untrusted external text — React escapes it; it is never markup. */
function PromptCard({ repo }: { repo: Repo }) {
  const [clamped, setClamped] = useState(true);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Optimized SDK prompt</h3>
          <p className="card-sub">source: {repo.promptSource}</p>
        </div>
        <button type="button" className="btn-ghost" data-prompt-toggle="" onClick={() => setClamped((v) => !v)}>
          {clamped ? 'Expand' : 'Collapse'}
        </button>
      </div>
      <pre className={clamped ? 'prompt is-clamped' : 'prompt'} data-prompt="">
        {repo.prompt}
      </pre>
      <div
        className="card-foot muted sm"
        data-prompt-foot=""
        style={clamped ? undefined : { display: 'none' }}
      >
        {repo.prompt.length} characters · truncated
      </div>
    </div>
  );
}

export function RepoDetail({ repo, idx }: { repo: Repo; idx: number }) {
  const [snap, setSnap] = useState(DEFAULT_SNAP);
  const top = topSev(repo);
  const total = wall(repo);

  return (
    <div
      className="repo-detail"
      data-testid="repo-card"
      data-idx={idx}
      data-repo={repo.url}
      data-repo-id={repo.id}
      data-overall={repo.overall}
    >
      {/* Inner tabs are radio-driven (name scoped per repo index) so switching Plan / Logs /
          Metadata is pure CSS. The radios must be the FIRST children so their `~` sibling selectors
          can reach the `.tabs` labels and the `.tab-panel`s that follow. */}
      {TABS.map((t) => (
        <input
          key={t}
          type="radio"
          name={`rr-tab-${idx}`}
          id={`rr-tab-${idx}-${t}`}
          className="nav-radio"
          defaultChecked={t === 'plan'}
        />
      ))}

      <div className="card">
        <div className="detail-head">
          <div className="min0">
            <div className="detail-title-row">
              <h2 className="detail-title">{repo.key}</h2>
              <EcoChip e={repo.eco} />
              <SevChip s={top.sev} />
              <OverallChip overall={repo.overall} />
            </div>
            <a className="detail-url" href={repo.url} target="_blank" rel="noreferrer">
              {repo.url}
            </a>
          </div>
          <div className="ledger">
            {STATUS_ORDER.map((s) => (
              <OutChip key={s} k={s} text={`${s} ${repo.ledger[s] ?? 0}`} />
            ))}
          </div>
        </div>
        {repo.cloneError ? <p className="clone-error">clone error: {repo.cloneError}</p> : null}
        <SnapshotRail repo={repo} active={snap} onPick={setSnap} />
        <SnapshotDetails repo={repo} active={snap} />
      </div>

      <div className="tabs">
        {TABS.map((k) => (
          <label key={k} className={`tab-btn tab-${k}`} htmlFor={`rr-tab-${idx}-${k}`}>
            {k === 'logs'
              ? `Logs (${repo.logs.length})`
              : // The count is the number of packages the resolver actually walked. A repo whose graph
                // was never captured shows a bare "Dependencies" rather than "Dependencies (0)" — zero
                // is a measurement, and this is the absence of one.
                k === 'deps' && repo.inventory?.graphed
                ? `Dependencies (${repo.inventory.packages.length})`
                : TAB_LABELS[k]}
          </label>
        ))}
      </div>

      <div className="tab-panel" data-tab="plan">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Advisories ({repo.vulns.length})</h3>
              <p className="card-sub">
                skill: <code>{repo.skill}</code>
              </p>
            </div>
          </div>
          <ul className="advs">
            {repo.vulns.length === 0 ? (
              <li className="empty">no advisories</li>
            ) : (
              repo.vulns.map((v) => (
                <li className="adv" key={`${v.pkg}-${v.cve}`}>
                  <SevDot s={v.sev} sm />
                  <span className="adv-body">
                    <span className="mono adv-pkg">{v.pkg}</span>
                    <span className="muted">
                      {v.scope} · <span className="from">{v.from}</span> → <span className="to">{v.to}</span>
                      {v.cve ? ` · ${v.cve}` : ''}
                    </span>
                  </span>
                  <code className="tag">{v.action}</code>
                </li>
              ))
            )}
          </ul>
          <div className="card-foot">
            <p className="muted sm">Tools available to the agent</p>
            <div className="toolset">
              {(TOOLSETS[repo.eco] ?? []).map((t) => (
                <code className="tag" key={t}>
                  {t}
                </code>
              ))}
            </div>
          </div>
        </div>

        <PromptCard repo={repo} />
        <AppliedChanges repo={repo} />
      </div>

      {/* This repo's package inventory — the flattened dependency graph for THIS tree only. */}
      <div className="tab-panel" data-tab="deps">
        <DependencyInventory inventory={repo.inventory} />
      </div>

      <div className="tab-panel" data-tab="logs">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Stage logs</h3>
              <p className="card-sub">Captured stdout and stderr, tagged by pipeline stage.</p>
            </div>
          </div>
          <Logs repo={repo} />
        </div>
      </div>

      {/* The 4th tab — absent from the design mock entirely (record 0057/F2). */}
      <div className="tab-panel" data-tab="meta">
        <div className="grid-2">
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Repository</h3>
              </div>
            </div>
            <dl className="meta">
              <MetaRow k="Default branch" v={repo.meta.branch} mono />
              <MetaRow k="Commit" v={repo.meta.commit} mono />
              <MetaRow k="Last commit" v={repo.meta.lastCommit} />
              <MetaRow k="License" v={repo.meta.license} />
              <MetaRow k="Contributors" v={repo.meta.contributors} />
              <MetaRow k="Lines of code" v={repo.meta.loc.toLocaleString()} />
              <MetaRow k="Checkout size" v={`${(repo.meta.sizeKb / 1024).toFixed(1)} MB`} />
              <MetaRow k="Clone time" v={ms(repo.meta.cloneMs)} />
            </dl>
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Build surface</h3>
              </div>
            </div>
            <dl className="meta">
              <MetaRow k="Ecosystem" v={eco(repo.eco).label} />
              <MetaRow k="Manifest" v={repo.meta.manifest} mono />
              <MetaRow k="Lockfile" v={repo.meta.lock} mono />
              <MetaRow k="Skill" v={repo.skill} mono />
              <MetaRow k="Snapshots" v={repo.snapshots.length} />
              <MetaRow k="Log lines" v={repo.logs.length} />
              <MetaRow k="Total wall time" v={ms(total)} />
            </dl>
            <div className="card-foot">
              <p className="muted sm">Stage timings</p>
              <div className="timings">
                {repo.stages.map((s) => (
                  <div className="timing" key={s.name}>
                    <span className="timing-k">{s.name}</span>
                    <div className="timing-track">
                      <div
                        className={s.status === 'ok' ? 'timing-fill ok' : 'timing-fill'}
                        style={{ width: `${total ? (s.duration / total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="timing-v">{ms(s.duration)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
