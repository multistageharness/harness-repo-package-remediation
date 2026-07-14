/**
 * src/errors-lib.mjs — the PURE half of the terminal `errors` stage (plan
 * run-health-and-errors-log, Epic 02): collect every failure/skip in the run
 * into one normalized record shape, classify + group them by ROOT CAUSE via
 * the EXISTING `src/diagnose-lib.mjs` taxonomy, and render the cause-first
 * `errors.logs` body. The atom (`configs/patterns/errors-consolidate.mjs`)
 * does the I/O (evidence extraction, the file write); this module does the
 * thinking, so it unit-tests without a flow and without a filesystem.
 *
 * THE ORGANIZING PRINCIPLE IS CAUSE, NOT REPO. In session f9f30203 ten repos
 * failed for ONE reason (Docker down → both local registries refusing). A
 * per-repo listing reproduces the original confusion at higher resolution —
 * ten locally-sensible entries, none of them the answer. One group with ten
 * members and a remedy IS the answer.
 *
 * NO SECOND CLASSIFIER. Classification reuses `classifyFailureText` /
 * `pickCause` / `describeCause` / `BENIGN_CAUSES` — the exact vocabulary the
 * validate stage scores with. A parallel pattern list would drift, and then
 * the HTML report and errors.logs would disagree about the same run, which is
 * worse than having neither.
 *
 * THE MIXED-CAUSE RULE (the dangerous inverse of the original bug): once the
 * pipeline can say "it's probably Docker", a REAL regression can hide behind
 * that sentence. So code-attributable groups are ALWAYS rendered first —
 * however few, however many repos the environmental group blocks — and the
 * "tells you nothing about your diff" line is printed ONLY when there are
 * zero code-attributable failures. A single genuine regression outranks ten
 * environmentally-blocked repos, because the blocked ones resolve themselves
 * when Docker starts and the regression will not.
 *
 * DETERMINISM: no clock, no random, no map-iteration-order dependence — groups
 * and members sort by stable keys, so the body is byte-identical across two
 * runs over the same inputs (golden-testable, diffable, trustworthy).
 *
 * REDACTION (security rule §5/§6): the body quotes raw subprocess output — the
 * one place this plan could plausibly CAUSE a credential leak. Every quoted
 * string passes `redactText` at WRITE time (classification may legitimately
 * need the raw text; the disk never does).
 */

import {
  ATTRIBUTABLE_CAUSES,
  classifyFailureText,
  describeCause,
  isBenignCause,
} from "./diagnose-lib.mjs";

/* ── collection: every stage's failure, one record shape ─────────────────── */

/**
 * The normalized failure record every channel walk produces:
 * `{ repo, stage, tool, status, cause, reason, artifactPath, evidenceLine, remedy }`
 * — `repo` is null for run-scoped facts (a down service), `cause` is a
 * diagnose-lib label or "unclassified", `artifactPath` points at the log that
 * justifies the claim (evidence extraction fills `evidenceLine` in the atom).
 * `command`/`rescueCommand` are populated only on `degraded` records (0066/D1):
 * the argv that failed, and the argv that rescued it.
 */
function record({ repo = null, stage, tool = null, status, cause = null, reason = "", artifactPath = null, remedy = null, command = null, rescueCommand = null }) {
  return { repo, stage, tool, status, cause, reason, artifactPath, evidenceLine: null, remedy, command, rescueCommand };
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const repoName = (rec) => rec?.repo ?? rec?.url ?? null;

/**
 * A RESCUED step is not a failure (0066/A1). `configs/patterns/{install,build,test}-run.mjs`
 * mark a failed primary `recovered: true` when its `fallback:` rung succeeds, and
 * compute the stage verdict on that basis (`build-run.mjs:463`) — so the repo is
 * `ok`. This module is the one consumer that never read the flag: it collected on
 * raw `ok === false`, so every rescued primary was reported as a live failure and,
 * carrying no cause tag, escalated through `unclassified` to CODE-ATTRIBUTABLE. A
 * clean run then printed "fix these, they will not resolve themselves" about steps
 * that had already resolved themselves, in-run, via the exact rung the playbook is
 * designed around. `recovered` is part of the step contract every consumer must
 * read — these two predicates are how this stage reads it.
 */
const isRecovered = (step) => step?.recovered === true;
/** A record collected from a rescued step: reported, but never as a failure. */
export const isDegraded = (rec) => rec?.status === "degraded";
/** Split a collected set into the failures (which drive the verdict) and the degraded (which never do). */
export function splitDegraded(records) {
  const all = asArray(records);
  return { failures: all.filter((rec) => !isDegraded(rec)), degraded: all.filter(isDegraded) };
}

/** The command a step ran, for the degraded prose ("the primary `python3 -m build` failed"). */
const commandOf = (step) => (Array.isArray(step?.argv) && step.argv.length > 0 ? step.argv.join(" ") : (step?.tool ?? null));

/**
 * The step that rescued `steps[index]`. The three run patterns push the rescue
 * directly after the primary it recovers, so it is the next EXECUTED step at the
 * same location — matched by position, NOT by tool: the rescue is the same tool
 * on a different interpreter in the python lanes (`python3 -m build` →
 * `python -m build`) but a different tool entirely in the node lane
 * (`npm-ci` → `npm-install`). Guard-skip records (no `exitCode`) are stepped over.
 * Only ever consulted for a step already marked `recovered`, so a rescue exists.
 */
function findRescue(steps, index) {
  const primary = steps[index];
  for (let i = index + 1; i < steps.length; i++) {
    const step = steps[i];
    if (typeof step?.exitCode !== "number") continue; // a recorded guard skip, not a run
    if (step?.location !== primary?.location) continue;
    return step.ok === true ? step : null;
  }
  return null;
}

/**
 * ONE identity per repo. The playbook stages record the clone SLUG
 * (`carlosmarte-…__root-upgrade-pip`) while clone_results/validations record
 * the URL — counted naively, ten repos read as twenty and every blast-radius
 * number in the verdict is wrong. Prefer the slug; map URLs onto it via any
 * channel entry that carries both.
 * @param {object} channels
 * @returns {(entryOrRecord: object) => string|null}
 */
export function repoKeyer(channels = {}) {
  const urlToSlug = new Map();
  for (const key of ["installs", "builds", "tests", "install_verifications"]) {
    for (const entry of asArray(channels?.[key])) {
      if (typeof entry?.url === "string" && typeof entry?.repo === "string") urlToSlug.set(entry.url, entry.repo);
    }
  }
  for (const entry of asArray(channels?.clone_results)) {
    if (typeof entry?.url === "string" && typeof entry?.dir === "string") {
      const slug = entry.dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
      if (slug && !urlToSlug.has(entry.url)) urlToSlug.set(entry.url, slug);
    }
  }
  return (entry) => {
    const name = repoName(entry);
    if (name === null) return null;
    return urlToSlug.get(name) ?? name;
  };
}

/** service_health → one record per down/unreachable service (run-scoped, repo: null). */
function collectServiceFailures(serviceHealth) {
  return asArray(serviceHealth?.services)
    .filter((s) => s?.status === "down" || s?.status === "unreachable")
    .map((s) =>
      record({
        stage: "service",
        tool: s.id,
        status: s.status,
        cause: "environment",
        reason: `${s.id} is ${s.status === "down" ? "not running" : "unreachable"}: ${s.detail ?? ""}`.trim(),
        remedy: s.remedy ?? null,
      }),
    );
}

/** clone_results → recorded clone failures (0019/A1 lands them as data). */
function collectCloneFailures(cloneResults) {
  return asArray(cloneResults)
    .filter((c) => c?.failed === true)
    .map((c) =>
      record({
        repo: repoName(c),
        stage: "clone",
        status: "failed",
        cause: c.errorClass === "transient" ? "environment" : "unclassified",
        reason: `clone failed (${c.errorClass ?? "unknown"}): ${c.error ?? c.message ?? ""}`.trim(),
      }),
    );
}

/** One playbook-stage channel (installs | builds | tests) → failed/guard-skipped steps. */
function collectStageFailures(entries, stage) {
  const out = [];
  for (const entry of asArray(entries)) {
    const repo = repoName(entry);
    // A repo-level guard skip (registry-unreachable, circuit-open) — the 0063/A1
    // stage-invalidating skip — is a finding even when no step ran at all.
    if (entry?.status === "skipped" && typeof entry?.cause === "string" && entry.cause.length > 0) {
      out.push(
        record({
          repo,
          stage,
          status: "skipped",
          cause: entry.cause,
          reason: `${stage} ${entry.skipped ?? "skipped"}${entry.reason ? `: ${entry.reason}` : ""}`,
        }),
      );
    }
    const steps = asArray(entry?.steps);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step?.ok === false && isRecovered(step)) {
        // 0066/A1 + D1: the fallback rung rescued this primary — the stage is
        // `ok` and NOTHING here needs fixing. Collected as `degraded` so it is
        // neither a false alarm nor a blind spot: it renders in its own section
        // (renderDegraded) and is excluded from every verdict count.
        const rescue = findRescue(steps, i);
        out.push(
          record({
            repo,
            stage,
            tool: step.tool ?? null,
            status: "degraded",
            cause: step.cause ?? null,
            reason: `${step.tool ?? "step"} exited ${step.exitCode ?? "non-zero"}; the fallback succeeded`,
            artifactPath: step.stderrArtifact ?? step.artifact ?? null,
            command: commandOf(step),
            rescueCommand: commandOf(rescue),
          }),
        );
      } else if (step?.ok === false) {
        out.push(
          record({
            repo,
            stage,
            tool: step.tool ?? null,
            status: "failed",
            cause: step.cause ?? null,
            reason: `${step.tool ?? "step"} exited ${step.exitCode ?? "non-zero"}`,
            artifactPath: step.stderrArtifact ?? step.artifact ?? null,
          }),
        );
      } else if (typeof step?.skipped === "string" && step.cause) {
        out.push(
          record({
            repo,
            stage,
            tool: step.tool ?? null,
            status: "skipped",
            cause: step.cause,
            reason: `${step.tool ?? "step"} skipped: ${step.skipped}${step.reason ? ` (${step.reason})` : ""}`,
          }),
        );
      }
    }
  }
  return out;
}

/** install_verifications → failed verification findings, with their cause tag. */
function collectVerifyFailures(verifications) {
  const out = [];
  for (const entry of asArray(verifications)) {
    if (entry?.failed !== true) continue;
    out.push(
      record({
        repo: repoName(entry),
        stage: "install-verify",
        status: "failed",
        cause: entry.cause ?? null,
        reason: entry.causeDescription ?? "install verification failed (empty package dir / missing log)",
      }),
    );
  }
  return out;
}

/** validations → broken / bug package outcomes (the code-attributable ledger). */
function collectValidationFailures(validations) {
  const out = [];
  for (const entry of asArray(validations)) {
    for (const pkg of asArray(entry?.packages)) {
      if (pkg?.status !== "broken" && pkg?.status !== "bug") continue;
      out.push(
        record({
          repo: repoName(entry),
          stage: "validate",
          tool: pkg.package ?? null,
          status: pkg.status,
          // A broken with no upstream cause label is the conservative
          // "unexplained ⇒ attributable" default the validate stage uses.
          cause: pkg.cause ?? (pkg.status === "broken" ? "dependency-conflict" : null),
          reason: pkg.reason ?? `${pkg.status} outcome`,
        }),
      );
    }
  }
  return out;
}

/** remediations → apply failures (a manifest edit that did not land). */
function collectRemediationFailures(remediations) {
  return asArray(remediations)
    .filter((r) => typeof r?.skipReason === "string" && /edit failed|write failed/i.test(r.skipReason))
    .map((r) =>
      record({
        repo: repoName(r),
        stage: "remediate",
        tool: r.package ?? null,
        status: "failed",
        reason: r.skipReason,
      }),
    );
}

/**
 * Walk every failure-bearing channel and normalize. Absent/empty channels
 * yield zero records and NEVER throw — a partial run (crashed at stage 8) is
 * precisely when this module matters most.
 * @param {object} channels the flow state (or any subset of it)
 * @returns {Array<object>} normalized failure records
 */
export function collectFailures(channels = {}) {
  const c = channels ?? {};
  const key = repoKeyer(c);
  const records = [
    ...collectServiceFailures(c.service_health),
    ...collectCloneFailures(c.clone_results),
    ...collectStageFailures(c.installs, "install"),
    ...collectVerifyFailures(c.install_verifications),
    ...collectStageFailures(c.builds, "build"),
    ...collectStageFailures(c.tests, "test"),
    ...collectValidationFailures(c.validations),
    ...collectRemediationFailures(c.remediations),
  ];
  // One identity per repo (slug over URL), and one record per distinct claim —
  // a playbook step attempted at two locations with the same outcome is one
  // fact, not two lines of noise.
  const seen = new Set();
  const out = [];
  for (const rec of records) {
    rec.repo = rec.repo === null ? null : key({ repo: null, url: rec.repo }) ?? rec.repo;
    const dedupeKey = `${rec.repo ?? ""}|${rec.stage}|${rec.tool ?? ""}|${rec.reason}|${rec.artifactPath ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(rec);
  }
  return out;
}

/* ── classification + grouping ───────────────────────────────────────────── */

/** Resolve a record's cause: upstream tag first, else classify its text, else "unclassified". */
export function causeOf(rec) {
  if (typeof rec?.cause === "string" && rec.cause.length > 0) return rec.cause;
  return classifyFailureText(rec?.reason ?? "") ?? "unclassified";
}

/** Is this cause the code's fault? Unclassified counts as attributable (conservative). */
export function isAttributable(cause) {
  return ATTRIBUTABLE_CAUSES.has(cause) || (!isBenignCause(cause) && cause === "unclassified");
}

/**
 * The service a benign/environmental group is tied to, BY NAME — "10 repos
 * blocked by connection-refused errno noise" is a symptom; "blocked because devpi is not
 * running" is the answer. The remedy comes from the probe (one source of
 * truth), falling back to `describeCause` when no service is implicated.
 */
function environmentContext(serviceHealth) {
  const bad = asArray(serviceHealth?.services).filter((s) => s?.status === "down" || s?.status === "unreachable");
  if (bad.length === 0) return { services: [], remedies: [] };
  return { services: bad.map((s) => s.id), remedies: [...new Set(bad.map((s) => s.remedy).filter(Boolean))] };
}

/**
 * Group records by cause. Deterministic: groups sort attributable-first (the
 * mixed-cause rule), then by blast radius (bigger first), then by cause name;
 * members sort by repo name.
 * @param {Array<object>} records from `collectFailures`
 * @param {object} [serviceHealth] the service_health channel (names + remedy)
 * @returns {Array<{cause: string, describe: string, benign: boolean, services: string[],
 *   remedy: string|null, members: string[], records: Array<object>}>}
 */
export function groupByCause(records, serviceHealth = null) {
  const env = environmentContext(serviceHealth);
  const byCause = new Map();
  for (const rec of asArray(records)) {
    // 0066/A1: a rescued step never enters a failure group — and therefore
    // never reaches `computeVerdict`, which counts groups. Filtered HERE, at
    // the single door into the verdict, so no future caller can route around it.
    if (isDegraded(rec)) continue;
    const cause = causeOf(rec);
    if (!byCause.has(cause)) {
      byCause.set(cause, {
        cause,
        describe: describeCause(cause),
        benign: isBenignCause(cause),
        services: cause === "environment" ? env.services : [],
        remedies: cause === "environment" ? env.remedies : [],
        members: [],
        records: [],
      });
    }
    const group = byCause.get(cause);
    group.records.push(rec);
    const name = rec.repo;
    if (name && !group.members.includes(name)) group.members.push(name);
  }
  const groups = [...byCause.values()];
  for (const g of groups) {
    g.members.sort();
    // Run-scoped records (a down service) lead the group — they ARE the
    // explanation of everything under them; then stable repo/stage/tool order.
    g.records.sort((a, b) => {
      const scoped = Number(a.repo !== null) - Number(b.repo !== null);
      if (scoped !== 0) return scoped;
      return `${a.repo ?? ""}|${a.stage}|${a.tool ?? ""}`.localeCompare(`${b.repo ?? ""}|${b.stage}|${b.tool ?? ""}`);
    });
  }
  groups.sort((a, b) => {
    const attr = Number(isAttributable(b.cause)) - Number(isAttributable(a.cause));
    if (attr !== 0) return attr; // code-attributable first — never buried
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return a.cause.localeCompare(b.cause);
  });
  return groups;
}

/**
 * Group the DEGRADED records (0066/D1) by the step that degraded — stage+tool,
 * because the interesting fact is "every pip build on this host takes the
 * Anaconda path", not "repo X did". Deterministic: groups by blast radius then
 * key; members and records by name.
 * @param {Array<object>} records from `collectFailures` (failures are ignored)
 * @returns {Array<{stage: string, tool: string, command: string|null,
 *   rescueCommand: string|null, members: string[], records: Array<object>}>}
 */
export function groupDegraded(records) {
  const byKey = new Map();
  for (const rec of asArray(records)) {
    if (!isDegraded(rec)) continue;
    const tool = rec.tool ?? "step";
    const key = `${rec.stage}|${tool}`;
    if (!byKey.has(key)) {
      byKey.set(key, { stage: rec.stage, tool, command: rec.command ?? null, rescueCommand: rec.rescueCommand ?? null, members: [], records: [] });
    }
    const group = byKey.get(key);
    group.records.push(rec);
    if (rec.repo && !group.members.includes(rec.repo)) group.members.push(rec.repo);
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.members.sort();
    g.records.sort((a, b) => `${a.repo ?? ""}`.localeCompare(`${b.repo ?? ""}`));
  }
  groups.sort((a, b) => {
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return `${a.stage}|${a.tool}`.localeCompare(`${b.stage}|${b.tool}`);
  });
  return groups;
}

/* ── the verdict ─────────────────────────────────────────────────────────── */

/**
 * Compute the run verdict from the groups.
 * @returns {{kind: "clean"|"environment"|"code"|"mixed", codeRepos: string[],
 *   blockedRepos: string[], totalRepos: number, dominant: object|null,
 *   remedies: string[], remedy: string|null}}
 */
export function computeVerdict(groups, channels = {}) {
  const attributable = asArray(groups).filter((g) => isAttributable(g.cause));
  const benign = asArray(groups).filter((g) => !isAttributable(g.cause));
  const codeRepos = [...new Set(attributable.flatMap((g) => g.members))].sort();
  const blockedRepos = [...new Set(benign.flatMap((g) => g.members))].sort().filter((r) => !codeRepos.includes(r));
  const totalRepos = countRepos(channels);
  const kind = attributable.length === 0 ? (benign.length === 0 ? "clean" : "environment") : benign.length === 0 ? "code" : "mixed";
  const dominant = kind === "code" || kind === "mixed" ? attributable[0] : benign[0] ?? null;
  // The environmental remedies, wherever the environmental group ranks — the
  // CLI prints the remedy even when a code failure outranks it in the body.
  const remedies = [...new Set(benign.flatMap((g) => g.remedies ?? []))];
  return { kind, codeRepos, blockedRepos, totalRepos, dominant: dominant ?? null, remedies, remedy: remedies[0] ?? null };
}

/** Distinct repos the run touched — the blast-radius denominator (slug-normalized). */
export function countRepos(channels = {}) {
  const key = repoKeyer(channels);
  const names = new Set();
  for (const channel of ["validations", "installs", "builds", "tests", "clone_results"]) {
    for (const entry of asArray(channels?.[channel])) {
      const name = key(entry);
      if (name) names.add(name);
    }
  }
  return names.size;
}

/* ── rendering ───────────────────────────────────────────────────────────── */

const plural = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`;

/**
 * The verdict header — the ten lines most readers will read, and the only
 * part many will. Four elements always: root cause, blast radius, remedy, and
 * what the run does NOT tell you. Plain text: it is read in terminals and
 * pasted into chat — no ANSI, no markdown tables.
 */
export function renderVerdictHeader(verdict) {
  const lines = [];
  const { kind, codeRepos, blockedRepos, totalRepos } = verdict;

  if (kind === "clean") {
    lines.push("No errors recorded.");
    return lines;
  }

  if (kind === "environment") {
    lines.push("VERDICT: the environment, not the code.");
    const dominant = verdict.dominant;
    if (dominant?.services?.length > 0) {
      lines.push(`  Down: ${dominant.services.join(", ")}.`);
    }
    lines.push(`  ${dominant?.describe ?? "environmental failure"}`);
    for (const remedy of verdict.remedies) lines.push(`  → ${remedy}`);
    lines.push("");
    lines.push(`  ${plural(blockedRepos.length, "repo")} of ${totalRepos} BLOCKED by this.`);
    lines.push("  0 repos have a code-attributable failure.");
    if (blockedRepos.length >= totalRepos && totalRepos > 0) {
      // The line that would have saved the incident — printed ONLY when it is
      // true: zero code failures and nothing verified clean either.
      lines.push("  Nothing in this run tells you anything about your diff.");
    } else {
      lines.push(`  The ${plural(blockedRepos.length, "blocked repo")} tell you nothing about your diff; the rest verified without failure.`);
    }
    return lines;
  }

  if (kind === "code") {
    lines.push("VERDICT: the code.");
    lines.push(`  ${plural(codeRepos.length, "repo")} of ${totalRepos} carry a code-attributable failure.`);
    return lines;
  }

  // mixed — NEVER claim "the environment, not the code", and never print the
  // "tells you nothing" line: a real regression must not hide behind Docker.
  lines.push("VERDICT: mixed — a code-attributable failure AND environmental blocks.");
  lines.push(`  ${plural(codeRepos.length, "repo")} of ${totalRepos} carry a code-attributable failure — listed first below; fix these, they will not resolve themselves.`);
  lines.push(`  ${plural(blockedRepos.length, "repo")} additionally blocked by the environment.`);
  for (const remedy of verdict.remedies) lines.push(`  → Environmental remedy: ${remedy}`);
  return lines;
}

/** The explicit empty-case body: "clean" is a positive claim WITH A SCOPE. */
export function renderNoErrors(channels = {}) {
  const services = asArray(channels?.service_health?.services);
  const servicesLine =
    services.length > 0
      ? services.map((s) => `${s.id} (${s.status})`).join(", ")
      : channels?.service_health?.placeholder
        ? "not probed (mock run)"
        : "not probed";
  const stages = ["clone", "install", "install-verify", "build", "test", "validate"].filter((stage) => {
    const key = { clone: "clone_results", install: "installs", "install-verify": "install_verifications", build: "builds", test: "tests", validate: "validations" }[stage];
    return asArray(channels?.[key]).length > 0;
  });
  const total = countRepos(channels);
  return [
    "No errors recorded.",
    "",
    "Checked:",
    `  services   ${servicesLine}`,
    `  stages     ${stages.length > 0 ? stages.join(", ") : "none produced records"}`,
    `  repos      ${total > 0 ? `${total} of ${total} completed with no failure or skip` : "none processed"}`,
  ];
}

/** One group's body block: describe, members, remedy, and its evidence lines. */
function renderGroup(group, index) {
  const lines = [];
  const radius = group.members.length > 0 ? ` — ${plural(group.members.length, "repo")}` : " — run-scoped";
  lines.push(`[${index + 1}] ${group.cause}${radius}${isAttributable(group.cause) ? "  (code-attributable)" : ""}`);
  lines.push(`    ${group.describe}`);
  if (group.services?.length > 0) lines.push(`    services down: ${group.services.join(", ")}`);
  for (const remedy of group.remedies ?? []) lines.push(`    remedy: ${remedy}`);
  if (group.members.length > 0) lines.push(`    repos: ${group.members.join(", ")}`);
  for (const rec of group.records) {
    const where = rec.repo ? `${rec.repo} · ${rec.stage}` : rec.stage;
    const tool = rec.tool ? ` · ${rec.tool}` : "";
    lines.push(`      - ${where}${tool}: ${rec.reason}`);
    if (rec.artifactPath) {
      const cite = rec.evidenceLine ? `${rec.artifactPath}:${rec.evidenceLine.lineNumber}: ${rec.evidenceLine.text}` : `${rec.artifactPath}${rec.evidenceNote ? ` (${rec.evidenceNote})` : ""}`;
      lines.push(`        evidence: ${cite}`);
    } else if (rec.remedy && !(group.remedies?.length > 0)) {
      lines.push(`        remedy: ${rec.remedy}`);
    }
  }
  return lines;
}

/**
 * The DEGRADED section (0066/D1): steps that FAILED and were then RESCUED by
 * their fallback rung. No action is required — the stage is `ok` and the run is
 * `clean` — but silence would be its own lie. Three pip builds taking the
 * Anaconda interpreter because Homebrew's `python3` has no `build` module is a
 * real, invisible, host-level fact about how every Python repo in the run got
 * built; it deserves a sentence, not a false alarm and not nothing.
 *
 * Rendered LAST, after every failure group, and counted in NO verdict.
 */
export function renderDegraded(groups) {
  const list = asArray(groups);
  if (list.length === 0) return [];
  const lines = ["Degraded (succeeded via fallback — no action required, but worth knowing):", ""];
  list.forEach((group, i) => {
    const radius = group.members.length > 0 ? ` — ${plural(group.members.length, "repo")}` : "";
    const primary = group.command ? `the primary \`${group.command}\` failed` : "the primary step failed";
    const rescue = group.rescueCommand ? `the \`${group.rescueCommand}\` fallback succeeded` : "its fallback succeeded";
    lines.push(`  [${i + 1}] ${group.tool}${radius}: ${primary}; ${rescue}.`);
    // The cause + its evidence come from the PRIMARY's log — which survives the
    // rescue only because the rescue writes a `.fallback`-suffixed artifact
    // (src/playbook-lib.mjs). Before that, this line quoted the rescue's success.
    const explained = group.records.find((rec) => rec.evidenceLine || (rec.cause && rec.cause !== "unclassified"));
    if (explained?.cause && explained.cause !== "unclassified") lines.push(`      cause: ${describeCause(explained.cause)}`);
    if (explained?.evidenceLine) lines.push(`      evidence: ${explained.artifactPath}:${explained.evidenceLine.lineNumber}: ${explained.evidenceLine.text}`);
    if (group.members.length > 0) lines.push(`      repos: ${group.members.join(", ")}`);
    lines.push("");
  });
  return lines;
}

/**
 * Render the full errors.logs BODY (deterministic; already-redacted inputs are
 * the caller's job — the atom runs `redactText` over the final text as the
 * write-time gate). Returns the text WITHOUT a trailing timestamp: the body is
 * the golden-tested surface.
 * @param {{channels: object, records?: Array<object>}} input `records` lets the
 *   atom pass evidence-enriched records; omitted, they are collected here.
 */
export function renderErrorsLog({ channels = {}, records = null } = {}) {
  const collected = records ?? collectFailures(channels);
  // 0066/A1: the verdict is computed over the FAILURES alone. A run whose only
  // records are rescued steps is a clean run — and still says so out loud.
  const { failures, degraded } = splitDegraded(collected);
  const degradedSection = renderDegraded(groupDegraded(degraded));
  if (failures.length === 0) {
    const lines = [...renderNoErrors(channels)];
    if (degradedSection.length > 0) lines.push("", ...degradedSection);
    return `${lines.join("\n").replace(/\n+$/, "")}\n`;
  }
  const groups = groupByCause(failures, channels?.service_health);
  const verdict = computeVerdict(groups, channels);
  const lines = [...renderVerdictHeader(verdict), ""];
  lines.push(`Failures by root cause (${plural(groups.length, "group")}, ${plural(failures.length, "record")}):`);
  lines.push("");
  groups.forEach((group, i) => {
    lines.push(...renderGroup(group, i));
    lines.push("");
  });
  lines.push(...degradedSection);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/* ── redaction: the write-time gate (security rule §5/§6) ────────────────── */

/**
 * The redaction matrix for quoted subprocess output. This repo has no separate
 * scanner script to import, so this IS the canonical write-time matrix for
 * generated artifacts; keep it aligned with the pre-commit scanner agents'
 * pattern families (token prefixes, PEM blocks, basic-auth URLs, secret-ish
 * KEY=value assignments, long high-entropy strings).
 */
const REDACTIONS = [
  // Known token prefixes (GitHub, OpenAI/Anthropic-style sk-, LangSmith lsv2_,
  // Slack xox*, AWS AKIA, GitLab glpat-, npm).
  { re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9-_]{16,}|lsv2_[a-z]{2}_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|glpat-[A-Za-z0-9-_]{20,}|npm_[A-Za-z0-9]{36})\b/g, mask: "«redacted-token»" },
  // PEM / private-key blocks (multi-line).
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, mask: "«redacted-private-key»" },
  // Basic-auth in URLs: keep scheme + host, drop user:pass.
  { re: /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, mask: "$1«redacted-auth»@" },
  // KEY=value where the key smells secret. Value must be non-trivial.
  { re: /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|AUTH|CREDENTIAL)[A-Za-z0-9_]*)\s*[=:]\s*["']?[^\s"']{8,}["']?/g, mask: "$1=«redacted»" },
  // Long high-entropy blobs (base64-ish runs ≥ 40 chars with mixed classes).
  { re: /\b(?=[A-Za-z0-9+/=_-]{40,}\b)(?=[^\s]*[A-Z])(?=[^\s]*[a-z])(?=[^\s]*\d)[A-Za-z0-9+/=_-]{40,}\b/g, mask: "«redacted-blob»" },
];

/**
 * Mask anything secret-shaped in text bound for disk. Idempotent; never
 * throws; non-strings pass through unchanged.
 */
export function redactText(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const { re, mask } of REDACTIONS) out = out.replace(re, mask);
  return out;
}
