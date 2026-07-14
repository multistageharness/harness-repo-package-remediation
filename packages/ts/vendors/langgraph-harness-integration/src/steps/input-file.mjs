/**
 * steps/input-file.mjs — collect the ingest REFERENCE for the lane the user
 * picked in `ingest-source` (change record 0021/A3).
 *
 * Before 0021 this was the unconditional first step and prompted for exactly one
 * thing: a local CSV/XLSX path. It now runs SECOND and dispatches on
 * `ctx.plan.ingestSource`, because a URL, a repo directory, or "dependabot" all
 * fail the old `validateInputPath` guard:
 *
 *   local_csv    → path prompt   + `validateInputPath`      (unchanged behavior)
 *   remote_csv   → URL prompt    + `validateRemoteCsvUrl`   (https + .csv/.xlsx)
 *   local_repo   → dir prompt    + `validateLocalRepoDir`   (exists + .git/)
 *   remote_repo  → URL prompt    + `validateRemoteRepoUrl`  (the SHARED repo-URL canon)
 *   preset_list  → no prompt     (placeholder lane — 0021/D4)
 *   dependabot   → no prompt     (placeholder lane — 0021/D4)
 *
 * Whatever the lane, the accepted answer lands on `ctx.plan.ingestRef` — the
 * value the child flow's chosen lane consumes as `ingest_ref`. `local_csv`
 * additionally keeps `ctx.plan.inputPath` (absolute), because the three
 * spreadsheet steps that follow (`preview`, `header-select`, `repo-column`)
 * re-parse that file in-process to show the user what they're about to run.
 *
 * Re-ask on failure (bounded) or accept an explicit `abort`, exactly as before.
 */
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";

import { WizardDone } from "../step-control.mjs";
import { laneFor, laneNeedsRef, validateLocalRepoDir, validateRemoteCsvUrl, validateRemoteRepoUrl } from "../ingest-lanes.mjs";

const SUPPORTED = [".csv", ".xlsx"];
const MAX_ATTEMPTS = 5;

/**
 * Pure guard: a resolved path must exist and carry a supported extension.
 * @param {string} abs absolute path
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateInputPath(abs) {
  if (!existsSync(abs)) return { ok: false, reason: "file not found" };
  if (!SUPPORTED.includes(extname(abs).toLowerCase())) {
    return { ok: false, reason: "unsupported extension (expected .csv or .xlsx)" };
  }
  return { ok: true };
}

/**
 * Per-lane resolve + validate of one raw answer. Returns the value to store on
 * `ctx.plan.ingestRef` (already rooted, for the two local lanes).
 * @param {string} lane an `ingest_source` token
 * @param {string} answer the raw prompt answer
 * @param {string} cwd invocation cwd (local lanes resolve against it)
 * @returns {{ok: true, ref: string} | {ok: false, reason: string}}
 */
export function resolveIngestRef(lane, answer, cwd) {
  switch (lane) {
    case "local_csv": {
      const abs = resolve(cwd, answer);
      const { ok, reason } = validateInputPath(abs);
      return ok ? { ok: true, ref: abs } : { ok: false, reason: `Invalid input file: ${reason}` };
    }
    case "remote_csv": {
      const { ok, reason } = validateRemoteCsvUrl(answer);
      return ok ? { ok: true, ref: answer } : { ok: false, reason: `Invalid remote CSV URL: ${reason}` };
    }
    case "local_repo": {
      const abs = resolve(cwd, answer);
      const { ok, reason } = validateLocalRepoDir(abs);
      return ok ? { ok: true, ref: abs } : { ok: false, reason: `Invalid local repo: ${reason}` };
    }
    case "remote_repo": {
      const { ok, reason } = validateRemoteRepoUrl(answer);
      return ok ? { ok: true, ref: answer } : { ok: false, reason: `Invalid repo URL: ${reason}` };
    }
    default:
      return { ok: false, reason: `Unknown ingest source '${lane}'` };
  }
}

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 */
export async function inputFileStep(ctx) {
  const source = ctx.plan.ingestSource ?? "local_csv";
  const lane = laneFor(source);

  // Placeholder lanes take no reference — nothing to prompt for (0021/A3.2).
  if (!laneNeedsRef(source)) {
    ctx.plan.ingestRef = "";
    ctx.prompt.info(`The '${source}' lane takes no input reference — skipping the path prompt.`);
    return;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const answer = (await ctx.prompt.text({ message: lane.prompt, placeholder: lane.placeholder })).trim();
    if (answer.toLowerCase() === "abort") throw new WizardDone(0);
    if (answer === "") {
      ctx.prompt.warn("Please enter a value (or 'abort' to quit).");
      continue;
    }
    const result = resolveIngestRef(source, answer, ctx.cwd);
    if (result.ok) {
      ctx.plan.ingestRef = result.ref;
      // The three spreadsheet steps downstream re-parse this file in-process.
      if (source === "local_csv") ctx.plan.inputPath = result.ref;
      ctx.prompt.success(`Using ${lane.ref}: ${result.ref}`);
      return;
    }
    ctx.prompt.error(result.reason);
  }
  throw new WizardDone(1);
}
