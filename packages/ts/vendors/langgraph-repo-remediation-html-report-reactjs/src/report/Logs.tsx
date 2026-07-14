/**
 * Logs.tsx — the stage-log viewer.
 *
 * Every line is rendered up front; the stage select, the search box, and the wrap toggle only
 * change VISIBILITY. That is the same contract the rest of the report keeps (record 0057/D3): the
 * content is in the markup, so it survives with JS off, and `behavior.test.mjs` can assert on log
 * text — e.g. that an `n/a` build emits `build: not applicable` and NOT a phantom `npm run build`
 * (record 0042/A3).
 */
import { useMemo, useState } from 'react';

import { withKeys } from './keys';
import type { Repo } from './types';

export function Logs({ repo }: { repo: Repo }) {
  const [stage, setStage] = useState('all');
  const [term, setTerm] = useState('');
  const [wrap, setWrap] = useState(false);

  const stagesPresent = useMemo(() => [...new Set(repo.logs.map((l) => l.stage))], [repo.logs]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of repo.logs) c[l.level] = (c[l.level] || 0) + 1;
    return c;
  }, [repo.logs]);

  const q = term.toLowerCase().trim();
  const visible = (l: Repo['logs'][number]) =>
    (stage === 'all' || l.stage === stage) && (!q || l.msg.toLowerCase().includes(q));
  const shown = repo.logs.filter(visible).length;

  return (
    <div className="logs" data-repo-id={repo.id}>
      <div className="logs-bar">
        <select className="log-stage-sel" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="all">All stages ({repo.logs.length})</option>
          {stagesPresent.map((s) => (
            <option key={s} value={s}>
              {s} ({repo.logs.filter((l) => l.stage === s).length})
            </option>
          ))}
        </select>
        <input
          className="log-search"
          type="search"
          placeholder="Filter log lines"
          aria-label="filter logs"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <div className="logs-counts">
          {counts.warn ? <span className="c-warn">{counts.warn} warnings</span> : null}
          <span className="c-ok">{counts.ok || 0} ok</span>
          <label className="log-wrap">
            <input type="checkbox" className="log-wrap-cb" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />{' '}
            Wrap
          </label>
        </div>
      </div>

      <div className={wrap ? 'log-body wrap' : 'log-body'}>
        {withKeys(repo.logs, (l) => `${l.stage}|${l.t}|${l.msg}`).map(({ item: l, key }) => (
          <div
            key={key}
            className="log-line"
            data-stage={l.stage}
            data-msg={l.msg.toLowerCase()}
            hidden={!visible(l)}
          >
            <span className="log-t">{l.t}</span>
            <span className="log-stage">{l.stage}</span>
            <span className={`log-lvl lvl-${l.level}`}>{l.level === 'cmd' ? '$' : l.level}</span>
            <span className="log-msg">{l.msg}</span>
          </div>
        ))}
        <div className="log-empty" hidden={shown !== 0}>
          No lines match the filter.
        </div>
      </div>
    </div>
  );
}
