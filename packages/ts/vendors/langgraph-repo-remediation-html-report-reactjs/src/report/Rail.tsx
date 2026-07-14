/**
 * Rail.tsx — the right-hand rail for one repository: pass-rate donut, Outcome ledger, References.
 *
 * The OUTCOME LEDGER here is one of record 0056's fixes and is NOT droppable (record 0057/Q2). The
 * design mock could not express it at all: its `Repo.outcome` was a single scalar verdict, where the
 * generator carries a per-repo `ledger` map of counts (record 0057/F3).
 */
import { SevChip } from './chips';
import { OUTCOME } from './tokens';
import type { Repo } from './types';

export function Rail({ repo, idx, passRate }: { repo: Repo; idx: number; passRate: number | null }) {
  const circ = 2 * Math.PI * 42;
  const rate = passRate ?? 0;

  return (
    <div className="rail-group" data-idx={idx} data-repo-id={repo.id}>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Pass rate</h3>
          </div>
        </div>
        <div className="donut">
          <svg
            width="104"
            height="104"
            viewBox="0 0 104 104"
            role="img"
            aria-label={passRate === null ? 'pass rate: not yet decided' : `pass rate: ${rate}%`}
          >
            <circle cx="52" cy="52" r="42" fill="none" stroke="#e2e8f0" strokeWidth="10" />
            <circle
              cx="52"
              cy="52"
              r="42"
              fill="none"
              stroke="#059669"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(circ * rate) / 100} ${circ}`}
              transform="rotate(-90 52 52)"
            />
            <text x="52" y="57" textAnchor="middle" fontSize="20" fontWeight="600" fill="#0f172a">
              {passRate === null ? '—' : `${rate}%`}
            </text>
          </svg>
          <div className="donut-note">
            <p className="strong sm">Decided outcomes only</p>
            fixed ÷ (fixed + broken + bug). Blocked and skipped are excluded, so a down registry never depresses
            the score.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Outcome ledger</h3>
            <p className="card-sub">This repository</p>
          </div>
        </div>
        <div className="rail-ledger">
          {Object.entries(repo.ledger).map(([k, v]) => (
            <div className="rail-led" key={k}>
              <span className="rail-led-k">
                <span className="dot" style={{ background: OUTCOME[k as keyof typeof OUTCOME] }} />
                {k}
              </span>
              <span className={v > 0 ? 'rail-led-v' : 'rail-led-v zero'}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>References</h3>
          </div>
        </div>
        <div className="refs">
          {repo.vulns.map((v) => (
            <a
              className="ref"
              key={`${v.pkg}-${v.cve}`}
              href={`https://nvd.nist.gov/vuln/detail/${v.cve}`}
              target="_blank"
              rel="noreferrer"
            >
              <div className="min0">
                <p className="mono ref-cve">{v.cve || '—'}</p>
                <p className="muted sm ref-pkg">{v.pkg}</p>
              </div>
              <SevChip s={v.sev} />
            </a>
          ))}
          <a className="ref ref-repo" href={repo.url} target="_blank" rel="noreferrer">
            View repository →
          </a>
        </div>
      </div>
    </div>
  );
}
