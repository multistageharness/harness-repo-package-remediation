/**
 * commands.errorsConsolidate — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the TERMINAL `errors`
 * stage (plan run-health-and-errors-log, Epic 02). Runs last — after
 * `html_report`, when every channel is populated — and consolidates every
 * failure, skip, and environmental signal in the run into ONE cause-first file
 * at the session root: `<session>/errors.logs`. The first line a human reads
 * is the cause and the remedy, not "tsc exited 2".
 *
 * PURE AGGREGATOR: it discovers nothing (Epic 01's health probe and the 0063
 * preflight did that) and mutates nothing. The thinking lives in
 * `src/errors-lib.mjs` (collect → classify via diagnose-lib → group by cause →
 * render); this atom does the I/O: bounded evidence extraction from the step
 * logs, and the redacted file write.
 *
 * NON-GATING — A HARD REQUIREMENT. The stage NEVER fails the run: an
 * aggregator that crashes while explaining a crash destroys the evidence of
 * the thing it was built to explain. The whole body is wrapped; an internal
 * error writes what it has plus a note that consolidation partially failed,
 * and returns normally.
 *
 * ALWAYS WRITTEN (feature 02/03 — silence is not success): a clean run writes
 * an explicit "No errors recorded" body naming what WAS checked, and a --mock
 * run writes the file too. The file's ABSENCE therefore means exactly one
 * thing — the errors stage did not run — never "the run was clean" (0051/A3:
 * absent ≠ skipped, one stage later).
 *
 * SESSION ROOT, NOT PACK DIR — deliberately. The 0053 ownership rule says pack
 * logs live under the pack render dir, and errors.logs is arguably a pack
 * ledger. It goes to the session root anyway: it is a RUN-WIDE fact ("what
 * happened to this run"), belongs beside repos/, fingerprints.json, and
 * integrated.json — the artifacts a human already opens — and would be hidden
 * two directories down in a pack subdir. Note there is NO out_dir in the
 * committed flow: the path arrives via the outputStep/flow-plan seam (a
 * `../../` literal here is exactly how 0043/0046 scattered artifacts into the
 * vendor directory). The internal default below answers only for a bare
 * committed-yaml run, matching fingerprint_report's rooting so the file stays
 * a SIBLING of fingerprints.json in every topology.
 *
 * REDACTION (security rule §5/§6): the file quotes raw subprocess output — the
 * messiest text in the run. Everything passes `redactText` at write time.
 *
 * Trust boundary: lives under `configs/patterns/`; imports only the pack's own
 * `src/` bridges. No subprocess at all.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { classifyFailureText } from "../../src/diagnose-lib.mjs";
import {
  collectFailures,
  computeVerdict,
  groupByCause,
  redactText,
  renderErrorsLog,
  splitDegraded,
} from "../../src/errors-lib.mjs";

export const meta = {
  name: "commands.errorsConsolidate",
  category: "commands",
  summary:
    "Terminal errors stage (run-health-and-errors-log Epic 02): consolidate every failure in the run into <session>/errors.logs, grouped by ROOT CAUSE with evidence, redacted, deterministic, and written on EVERY run — clean and mock included. Non-gating.",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      // Channel the errors summary (verdict + absolute file path) is written into.
      into: { type: "string", minLength: 1 },
      // Artifact filename at the session root.
      filename: { type: "string", minLength: 1 },
      // Session root the file lands in. Supplied by the render seam
      // (outputStep/flow-plan → the OVERLAYS allowlist); absent on a bare
      // committed-yaml run, where the internal default keeps the file a
      // sibling of fingerprints.json.
      out_dir: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

/** Bounded read: evidence extraction must survive a 40 MB log (devpi taught us). */
const EVIDENCE_READ_BYTES = 64 * 1024;
/** Cap quoted evidence lines to something a human reads, not a second log. */
const EVIDENCE_LINE_MAX = 240;
/** A representative sample per group, never the whole log set. */
const EVIDENCE_PER_GROUP = 5;

/** First line of `text` whose classification matches `cause` (reuses diagnose-lib — no new regexes). */
export function findEvidenceLine(text, cause) {
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    if (cause && classifyFailureText(line) === cause) {
      return { lineNumber: i + 1, text: line.slice(0, EVIDENCE_LINE_MAX) };
    }
  }
  // No cause-matching line (or no cause): the first non-empty line is still
  // better evidence than none.
  const idx = lines.findIndex((l) => l.trim().length > 0);
  return idx === -1 ? null : { lineNumber: idx + 1, text: lines[idx].trim().slice(0, EVIDENCE_LINE_MAX) };
}

/**
 * Session-relative artifact paths: no absolute host path reaches the body
 * (root CLAUDE.md — host paths leak the machine's layout and would make the
 * golden machine-specific).
 */
export function sessionRelativePath(p, sessionRoot) {
  if (typeof p !== "string" || p.length === 0) return p;
  if (sessionRoot && isAbsolute(p) && p.startsWith(sessionRoot)) return relative(sessionRoot, p) || ".";
  // A foreign absolute path (fixture data, an older session): cut at the
  // session segment when one exists.
  return p.replace(/^.*[\\/]\.harness[\\/][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\\/]/i, "");
}

/** Test seam: injected fs so the unit tests drive bounded reads without a disk. */
export function _errorsConsolidateWith({ read = readFile, write = writeFile, ensureDir = (d) => mkdir(d, { recursive: true }) } = {}) {
  return function errorsConsolidateFactory(params, ctx) {
    return async (state) => {
      const filename = typeof params.filename === "string" && params.filename.length > 0 ? params.filename : "errors.logs";
      // Rooting mirrors the sibling report atoms: absolute when the render
      // seam supplied it, flow-dir-relative otherwise. The bare-run default
      // matches fingerprint_report's committed "../../.harness" so errors.logs
      // stays a sibling of fingerprints.json in every topology.
      const outDirParam = typeof params.out_dir === "string" && params.out_dir.length > 0 ? params.out_dir : "../../.harness";
      const sessionRoot = isAbsolute(outDirParam) ? outDirParam : resolve(ctx.options.baseDir, outDirParam);
      const outPath = resolve(sessionRoot, filename);

      try {
        const records = collectFailures(state);

        // Evidence extraction (bounded, capped, throw-proof): a missing log is
        // itself evidence — the stage that would have written it was skipped.
        // The read doubles as FORENSIC classification: a failed step whose
        // record carries no cause tag (the first attempt of a two-front
        // playbook, e.g. `python3 -m build` before the `python -m build`
        // fallback got tagged) is classified from its OWN log here — otherwise
        // an environmental failure lands in the code-attributable
        // "unclassified" bucket, which is the exact false verdict this stage
        // exists to kill.
        const perGroupBudget = new Map();
        for (const rec of records) {
          if (!rec.artifactPath) continue;
          const absPath = rec.artifactPath;
          rec.artifactPath = sessionRelativePath(absPath, sessionRoot);
          let text = null;
          try {
            const buf = await read(absPath);
            text = buf.subarray ? buf.subarray(0, EVIDENCE_READ_BYTES).toString("utf8") : String(buf).slice(0, EVIDENCE_READ_BYTES);
          } catch {
            rec.evidenceNote = "log absent — the stage was skipped before writing it";
            continue;
          }
          if (!rec.cause) rec.cause = classifyFailureText(text);
          const budgetKey = rec.cause ?? "unclassified";
          const used = perGroupBudget.get(budgetKey) ?? 0;
          if (used >= EVIDENCE_PER_GROUP) continue;
          perGroupBudget.set(budgetKey, used + 1);
          rec.evidenceLine = findEvidenceLine(text, rec.cause);
        }

        const body = renderErrorsLog({ channels: state, records });
        // The write-time redaction gate (security rule §5/§6): the raw text may
        // matter for classification above; the disk never sees it unmasked.
        const text = redactText(body);
        await ensureDir(sessionRoot);
        await write(outPath, text, "utf8");

        // 0066/A1: the verdict is computed over the FAILURES — a rescued step
        // (`recovered: true`) is reported in its own degraded section and counts
        // toward nothing. `groupByCause` drops them; `degraded` carries the tally
        // so the CLI can say "clean, and here is what limped" in one line.
        const { failures, degraded } = splitDegraded(records);
        const groups = groupByCause(failures, state?.service_health);
        const verdict = computeVerdict(groups, state);
        return {
          [params.into]: {
            placeholder: false,
            ok: true,
            path: outPath,
            verdict: verdict.kind,
            dominantCause: verdict.dominant?.cause ?? null,
            remedy: verdict.remedy,
            codeRepos: verdict.codeRepos,
            blockedRepos: verdict.blockedRepos,
            totalRepos: verdict.totalRepos,
            groups: groups.length,
            records: failures.length,
            degraded: degraded.length,
          },
        };
      } catch (err) {
        // NON-GATING: never let the explainer crash the run it is explaining.
        // Best-effort partial write, then a normal return.
        const note = `errors consolidation partially failed: ${err?.message ?? err}\n`;
        try {
          await ensureDir(sessionRoot);
          await write(outPath, redactText(note), "utf8");
        } catch {
          // even the fallback write failed — the summary channel still records it
        }
        return { [params.into]: { placeholder: false, ok: false, path: outPath, error: String(err?.message ?? err) } };
      }
    };
  };
}

export const errorsConsolidate = _errorsConsolidateWith({});
