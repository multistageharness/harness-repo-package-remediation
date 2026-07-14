/**
 * PipelineHealth.tsx — did the run get through, and where did it stop?
 *
 * REPLACES the old "Pipeline" card, which was a HARDCODED list of nine architecture strings
 * (`'fingerprint → integrate'`, `'snapshot → install → install-verify'`) with a few counts
 * interpolated into them. Three things were wrong with it, and they compound:
 *
 *   1. It rendered THE SAME TEXT whether every stage passed or every stage failed. It read like a
 *      status panel and carried no status. A reader looking for "did this work?" — which is the
 *      only question a non-technical reader has — found nine command strings and no answer.
 *   2. It said "Nine stages" while the stage spine the generator actually stamps is SIX
 *      (`data.mjs` STAGE_NAMES: clone, remediate, install, build, test, validate). The drift was
 *      already noted in `types.ts`'s header and had been sitting in the UI regardless.
 *   3. `repo.stages[]` — the real per-stage `{name, status, duration}`, the thing that answers the
 *      question — was already in the JSON island, already rendered as anonymous dots in the
 *      run-results table, and aggregated nowhere.
 *
 * So this component invents no data and needs no generator change. It aggregates the statuses the
 * pipeline already stamps, and says what they mean in words.
 *
 * THE ONE RULE IT IS BUILT AROUND: a stage where anything failed must never read as passed. Every
 * roll-up here is worst-case — one failure in ten repositories makes the stage `failed`, loudly,
 * because the reader's next action depends on it. The counts beside it stay exact, so the severity
 * of the headline can always be checked against the arithmetic under it.
 */
import { STAGE_STATUS, stageCopy } from './tokens';
import type { Repo, StageStatus } from './types';

/** A stage rolled up across every repository that ran it. */
export interface StageHealth {
  name: string;
  counts: Record<StageStatus, number>;
  /** How many repositories reached this stage at all. Never assumed to be `repos.length`. */
  total: number;
  /** Worst-case verdict. `failed` if ANY repository failed here — never an average. */
  verdict: StageStatus;
}

const ZERO = (): Record<StageStatus, number> => ({ ok: 0, failed: 0, blocked: 0, skipped: 0, na: 0 });

/** Worst-first. The first bucket with anything in it names the stage — nothing is averaged away. */
const SEVERITY: StageStatus[] = ['failed', 'blocked', 'ok', 'skipped', 'na'];

/**
 * Roll `repos[].stages[]` up per stage.
 *
 * The stage spine is DERIVED — first-seen order across the repos, not a hardcoded list. That is the
 * whole bug the old card had: a literal list cannot be wrong loudly, it just quietly stops matching
 * the pipeline. A stage that only some repos ran shows a `total` below the repo count, and the copy
 * says so rather than padding it to look complete.
 *
 * A status outside the known vocabulary is counted as `na` rather than dropped: an unrecognized
 * status is not a passing one, and a bar that silently omits a repo has lost the reader's row.
 */
export function stageHealth(repos: Repo[]): StageHealth[] {
  const byName = new Map<string, StageHealth>();

  for (const r of repos) {
    for (const s of r.stages) {
      let h = byName.get(s.name);
      if (!h) {
        h = { name: s.name, counts: ZERO(), total: 0, verdict: 'na' };
        byName.set(s.name, h);
      }
      const key: StageStatus = s.status in h.counts ? s.status : 'na';
      h.counts[key] += 1;
      h.total += 1;
    }
  }

  for (const h of byName.values()) {
    h.verdict = SEVERITY.find((k) => h.counts[k] > 0) ?? 'na';
  }

  return [...byName.values()];
}

/** The one-sentence answer, in the reader's words rather than the pipeline's. */
function verdictLine(h: StageHealth): string {
  const { ok, failed, blocked, skipped, na } = h.counts;
  const repo = (n: number) => `${n} ${n === 1 ? 'repository' : 'repositories'}`;

  if (failed > 0) return `failed for ${repo(failed)}`;
  if (blocked > 0) return `blocked for ${repo(blocked)} — an outside problem, not a bad change`;
  if (ok > 0 && ok === h.total) return `passed for all ${repo(ok)}`;
  if (ok > 0) {
    const rest = [skipped > 0 ? `${skipped} skipped` : '', na > 0 ? `${na} not applicable` : '']
      .filter(Boolean)
      .join(', ');
    return `passed for ${repo(ok)}${rest ? ` · ${rest}` : ''}`;
  }
  if (skipped > 0 && na === 0) return `skipped for all ${repo(skipped)} — nothing to do`;
  return `did not apply to ${
    na === h.total ? `any of the ${repo(h.total)}` : repo(na)
  } — this step was not needed`;
}

/**
 * The banner. A run is "green" only if no stage failed AND no stage was blocked — and even then the
 * wording is chosen against the arithmetic, not against the absence of red.
 *
 * THE OVERCLAIM THIS EXISTS TO AVOID. The real run this shipped against passes every stage but has
 * `test` at 6 ok / 4 skipped. "Every step passed for all 10 repositories" is FALSE for that run:
 * tests did not pass for ten repositories, they ran for six and were skipped for four. Nothing red
 * is not the same fact as everything green, and a banner that conflates them tells a reader their
 * dependencies are tested when four of them were never tested at all. So a run with no failures but
 * incomplete coverage gets its own sentence, which says both halves.
 */
function headline(stages: StageHealth[], repoCount: number): { tone: StageStatus; text: string } {
  const failed = stages.filter((s) => s.verdict === 'failed');
  const blocked = stages.filter((s) => s.verdict === 'blocked');
  const step = (c: number) => `${c} ${c === 1 ? 'step' : 'steps'}`;
  const repo = `${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'}`;
  const name = (s: StageHealth) => stageCopy(s.name).title.toLowerCase();

  if (failed.length > 0) {
    return { tone: 'failed', text: `${step(failed.length)} failed: ${failed.map(name).join(', ')}.` };
  }
  if (blocked.length > 0) {
    return {
      tone: 'blocked',
      text: `${step(
        blocked.length,
      )} could not run because of an outside problem — a package registry or toolchain, not the changes themselves.`,
    };
  }

  // Nothing failed and nothing was blocked. Now: did every step actually run everywhere?
  const partial = stages.filter((s) => s.counts.ok !== s.total);
  if (partial.length === 0) {
    return { tone: 'ok', text: `Every step passed for all ${repo}. Nothing failed anywhere in the run.` };
  }
  return {
    tone: 'ok',
    text: `Nothing failed. But ${step(partial.length)} did not run for every repository — ${partial
      .map((s) => `${name(s)} (${s.counts.ok} of ${s.total})`)
      .join(', ')} — so those repositories are unproven rather than passing.`,
  };
}

/** One stage: what it does, how it went, and the exact split behind that claim. */
function StageRow({ h, i }: { h: StageHealth; i: number }) {
  const copy = stageCopy(h.name);
  return (
    <li className="ph-row" data-testid="pipeline-stage" data-stage={h.name} data-verdict={h.verdict}>
      <span className="ph-n">{String(i + 1).padStart(2, '0')}</span>

      <span className="ph-what">
        <span className="ph-title">{copy.title}</span>
        <span className="ph-blurb">{copy.blurb}</span>
      </span>

      {/* The bar is the whole stage, worst-first, so a failing slice is flush left where the eye
          lands. Widths come from the counts; nothing is rounded up to look full. */}
      <span className="ph-bar" aria-hidden="true">
        {STAGE_STATUS.map(({ key, hex }) =>
          h.counts[key] > 0 ? (
            <span
              key={key}
              className="ph-seg"
              data-status={key}
              style={{ width: `${(h.counts[key] / h.total) * 100}%`, background: hex }}
            />
          ) : null,
        )}
      </span>

      <span className="ph-count">
        <span className="ph-frac">
          {h.counts.ok}/{h.total}
        </span>
        <span className="ph-verdict">{verdictLine(h)}</span>
      </span>

      {/* The internal stage name is kept, last and quiet: an engineer reading a log needs it, and a
          reader who doesn't can ignore it. */}
      <code className="ph-slug">{h.name}</code>
    </li>
  );
}

/**
 * `rowsN` is the INGESTED DATASET's row count, and it is the one fact the old card carried that was
 * worth keeping. It is stated as run context rather than rendered as a stage row, because ingest is
 * a RUN-level step and `repo.stages[]` is a PER-REPO spine — inventing a status for it would mean
 * fabricating exactly the kind of fact this component exists to stop fabricating.
 */
export function PipelineHealth({ repos, rowsN }: { repos: Repo[]; rowsN: number }) {
  const stages = stageHealth(repos);
  const nRepo = `${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}`;
  const nRow = `${rowsN} ${rowsN === 1 ? 'row' : 'rows'}`;

  // An empty ingest has no stages to report on. Say that, rather than rendering an all-green
  // skeleton of a pipeline that never ran — a 0-of-0 bar reads as a pass.
  if (stages.length === 0) {
    return (
      <div className="card" data-testid="pipeline-health">
        <div className="card-head">
          <div>
            <h3>Pipeline health</h3>
            <p className="card-sub">Which steps of the run passed, and which did not.</p>
          </div>
        </div>
        <p className="ph-empty" data-testid="pipeline-empty">
          The dataset carried {nRow}, but no repositories were processed — so no steps ran.
        </p>
      </div>
    );
  }

  const head = headline(stages, repos.length);

  return (
    <div className="card" data-testid="pipeline-health">
      <div className="card-head">
        <div>
          <h3>Pipeline health</h3>
          <p className="card-sub">
            The dataset carried {nRow}; {nRepo} were cloned from it and taken through the same {stages.length}{' '}
            steps, in this order. A step counts as passed only if it passed for every repository that reached
            it.
          </p>
        </div>
      </div>

      <p className="ph-headline" data-testid="pipeline-headline" data-tone={head.tone}>
        <span className="ph-mark" aria-hidden="true">
          {head.tone === 'ok' ? '✓' : head.tone === 'failed' ? '✕' : '!'}
        </span>
        {head.text}
      </p>

      <ol className="ph-list">
        {stages.map((h, i) => (
          <StageRow key={h.name} h={h} i={i} />
        ))}
      </ol>

      <div className="card-foot">
        <div className="ph-legend">
          {STAGE_STATUS.map(({ key, hex, label }) => (
            <span className="ph-lg" key={key}>
              <i style={{ background: hex }} />
              {label}
            </span>
          ))}
        </div>
        <p className="muted sm">
          <strong>Blocked</strong> is not a failed change: the step could not run for an outside reason (a
          package registry being down, a pre-existing break in the project). <strong>Not applicable</strong>{' '}
          means the project has no such step to run — a repository with no test suite cannot fail its tests.
        </p>
      </div>
    </div>
  );
}
