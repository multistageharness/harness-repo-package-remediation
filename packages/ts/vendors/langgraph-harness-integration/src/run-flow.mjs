/**
 * src/run-flow.mjs — the validate → compile → run leg, driven in-process
 * through the vendored @internal/langgraph-langchain-harness-sdk (relative import via src/sdk.mjs — no
 * subprocess, no network). Validation issues are surfaced with their precise
 * `path: message` and mapped back to the wizard step that owns the field so
 * the orchestrator can re-route the user instead of crashing.
 */
import { existsSync } from "node:fs";

import { createRegistry, loadFlowConfig, validateFlow, compileFlow, runFlow, EVENT_TYPES, resolveLlmProvider } from "./sdk.mjs";
import { disableTracing, TRACING_OPT_IN } from "./tracing.mjs";

const KNOWN_EVENTS = new Set(EVENT_TYPES);

/**
 * Load + validate the materialized flow. Prints each `issue.path: message` on
 * failure. Returns everything the run leg needs so we don't re-load.
 * @param {import("./wizard.mjs").WizardCtx} ctx
 * @param {string} yamlPath
 * @returns {Promise<{ok: boolean, issues: Array, registry: object, config: object}>}
 */
export async function validateMaterialized(ctx, yamlPath) {
  const registry = await createRegistry(ctx.plan.mappingPath);
  const { config } = await loadFlowConfig(yamlPath);
  const { ok, issues } = await validateFlow(config, { mapping: registry.mapping });
  if (!ok) {
    ctx.prompt.error("Flow validation failed:");
    for (const issue of issues) ctx.prompt.error(`  ${issue.path}: ${issue.message}`);
  }
  return { ok, issues, registry, config };
}

/**
 * Compile + run the validated flow, streaming progress to the wizard output
 * via the vendored event hub. The interactive CLI runs real; `ctx.plan.mock` is
 * only ever `true` via the test seam (`runWizard(..., { mock: true })`).
 * @param {import("./wizard.mjs").WizardCtx} ctx
 * @param {{registry: object, config: object}} validated
 * @returns {Promise<{status: string, state: object, events: Array}>}
 */
export async function runMaterialized(ctx, { registry, config }) {
  // 0052/D1: kill LangSmith tracing BEFORE the graph is compiled/run. An ambient
  // LANGCHAIN_TRACING_V2 would otherwise export every stage of every run to a
  // third-party SaaS (and 429 once the tenant's trace quota is spent). This is the
  // seam every caller goes through — wizard, tests, library.
  const { disabled } = disableTracing();
  if (disabled.length > 0) {
    // Say so: silently overriding an explicit env var is its own surprise. Names
    // the opt-in, so the override is reversible by whoever meant it.
    ctx.prompt?.info?.(`LangSmith tracing disabled (${disabled.join(", ")}) — set ${TRACING_OPT_IN}=1 to re-enable.`);
  }
  // 0062/D2+D3 — resolve the LLM provider HERE, in the pack, and inject it. An
  // SDK-backed provider (claude-sdk | github-sdk) is constructed from the vendored
  // symlink; mock/anthropic/openai return null and the platform's own seam builds
  // them, exactly as before. A requested-but-unbuildable SDK THROWS (D4) rather
  // than silently degrading a 12-repo real run into mock detections.
  const mock = ctx.plan.mock === true;
  const { provider: llm, config: llmConfig } = await resolveLlmProvider({
    mock,
    env: process.env,
    onWarn: (message) => ctx.prompt?.error?.(message),
  });
  // Say which model is about to read a dozen third-party repos, BEFORE it does —
  // not afterwards, inferred from `result.mode` in an artifact.
  ctx.prompt?.info?.(
    `LLM provider: ${llmConfig.provider}${llmConfig.provider === "mock" ? " (offline, deterministic)" : ` · model ${llmConfig.model ?? "sdk default"}`}`,
  );

  const onEvent = makeProgressRenderer(ctx);
  const compiled = await compileFlow(config, {
    registry,
    options: { mock, ...(llm ? { llm } : {}) },
    onEvent,
  });
  try {
    return await runFlow(compiled, { threadId: `wizard-${config.name}` });
  } finally {
    await llm?.shutdown?.().catch?.(() => {});
  }
}

/**
 * Turn the enumerated run events into concise progress lines. Only consumes
 * known `EVENT_TYPES`; anything else is ignored. Deterministic enough to
 * assert the per-node lines in tests.
 *
 * The clone stage is a real per-repo fan-out (`nodes.fanout` over `repos` →
 * `clone_repo`), so `fanout.dispatch` gives the exact repo count and each
 * `clone_repo` `node.end` is one finished repo. We open an ANIMATED progress bar
 * over that count (`ctx.prompt.progress({ animated: true })` — the vendored
 * `ProgressBar`) and advance it per repo, since this is genuine machine-paced
 * batch work that owns the terminal (no interactive prompt to fight). The
 * per-clone text lines are suppressed while the bar is live so they don't fight
 * the bar's in-place redraw; every other node still logs its `▸ …`/`done` line.
 *
 * The `fingerprint` and `integrate` stages (change record 0012/A1) are SINGLE
 * nodes that loop over all repos INTERNALLY — no per-repo fan-out node to key a
 * bar on. Their pack-local atoms therefore emit one bounded `loop.guard`
 * (`{ node, count, max, kind: "stage" }`) per repo (a REUSED known SDK event
 * type — the vendored hub throws on unknown types, so no custom name and no
 * pristine-SDK edit; see the atoms). We open the SAME animated bar on the first
 * such event for a node and advance it per event, closing idempotently — the
 * `render`/`*_report` nodes are single non-looping templating steps and keep
 * their coarse `▸ …`/`done` line (0012/D1).
 * @param {import("./wizard.mjs").WizardCtx} ctx
 */
export function makeProgressRenderer(ctx) {
  const out = (s) => ctx.prompt.log(s);
  let repoBar = null; // active per-repo clone bar (may be undefined if the binding omits the seam)
  let cloneActive = false; // a clone fan-out is in progress
  let cloned = 0;
  let repoTotal = 0;
  const closeRepoBar = () => {
    if (!cloneActive) return;
    repoBar?.done();
    repoBar = null;
    cloneActive = false;
    cloned = 0;
    repoTotal = 0;
  };
  // Active per-repo bar for a single looping stage (fingerprint | integrate).
  let stageBar = null;
  let stageNode = null; // the node id the current stage bar belongs to
  let stageTotal = 0;
  let stageDone = 0;
  const closeStageBar = () => {
    if (stageNode === null) return;
    stageBar?.done();
    stageBar = null;
    stageNode = null;
    stageTotal = 0;
    stageDone = 0;
  };
  return (ev) => {
    if (!ev || !KNOWN_EVENTS.has(ev.type)) return;
    switch (ev.type) {
      case "run.start":
        out(`▸ run start${ev.mock ? " (mock)" : ""}`);
        break;
      case "fanout.dispatch":
        // Open the per-repo bar for the clone fan-out — ONCE. The fan-out surfaces
        // TWO dispatch events (the `fan` marker node + the edges.fanout emission);
        // the `cloneActive` guard ignores the second so we don't close+reopen.
        if (ev.over === "repos" && (ev.count ?? 0) > 0 && !cloneActive) {
          cloneActive = true;
          repoTotal = ev.count;
          cloned = 0;
          out(`▸ cloning ${repoTotal} repo${repoTotal === 1 ? "" : "s"} …`);
          repoBar = ctx.prompt.progress?.({ total: repoTotal, label: "cloning repos", animated: true });
        }
        break;
      case "loop.guard":
        // 0054/D1+D2 — an unreachable registry (or a tripped circuit breaker) is
        // the one thing a run must never hide: it is why session c87d0310 slept
        // for 19 minutes and still reported success. Print it, loudly, with the
        // real cause and the real fix. `service-health` (run-health-and-errors-log
        // Epic 01) is the same contract one stage earlier: "Docker is not
        // running" appears at the TOP of the run, not only in errors.logs.
        if ((ev.kind === "registry-preflight" || ev.kind === "circuit-open" || ev.kind === "service-health") && ev.message) {
          closeStageBar();
          for (const line of String(ev.message).split("\n")) out(`✗ ${line}`);
          break;
        }
        // Per-repo tick for a single looping stage (fingerprint | integrate).
        // Only our pack-emitted, node-scoped `kind: "stage"` guards drive a bar;
        // genuine edge/agent loop guards fall through untouched.
        if (ev.kind === "stage" && ev.node) {
          if (stageNode !== ev.node) {
            closeStageBar(); // a different stage started — finish the prior bar
            stageNode = ev.node;
            stageTotal = ev.max ?? 0;
            stageDone = 0;
            stageBar = ctx.prompt.progress?.({ total: stageTotal, label: ev.node, animated: true });
          }
          stageDone++;
          stageBar?.advance(1);
          if (stageTotal > 0 && stageDone >= stageTotal) closeStageBar(); // last repo — finish the bar
        }
        break;
      case "node.start":
        // A non-clone stage starting means the clone fan-out (and any prior stage
        // bar) is done — close them before that stage logs its own line.
        if (ev.node !== "clone_repo") {
          closeRepoBar();
          closeStageBar();
          out(`▸ ${ev.node ?? ev.id ?? "node"} …`);
        }
        break;
      case "node.end":
        if (ev.node === "clone_repo") {
          if (cloneActive) {
            cloned++;
            repoBar?.advance(1);
            if (cloned >= repoTotal) closeRepoBar(); // last repo — finish the bar
          }
        } else {
          // A looping stage's bar closes here if it didn't reach its total (empty
          // or short list) — the coarse `done` line stays suppressed only while
          // the bar was live, so print it once the bar is finished.
          if (stageNode === ev.node) closeStageBar();
          out(`  ${ev.node ?? ev.id ?? "node"} done`);
        }
        break;
      case "run.end":
        closeRepoBar();
        closeStageBar();
        out(`▸ run end (${ev.errors ?? 0} error${ev.errors === 1 ? "" : "s"})`);
        break;
      case "run.error":
        closeRepoBar();
        closeStageBar();
        out(`✗ run error: ${ev.error ?? "unknown"}`);
        break;
      default:
        break;
    }
  };
}

/**
 * The CLI exit verdict (run-health-and-errors-log Epic 03): put the
 * consolidated cause where the human is already looking — the terminal they
 * ran `make start` in — as the REMEDY, not the symptom. "4 builds failed"
 * sends a human to their diff; "Docker is not running" sends them to Docker.
 * That substitution is the deliverable.
 *
 * The absent-file case is load-bearing (feature 02/03): errors.logs is written
 * on EVERY run the errors stage reached, so a missing summary/file means the
 * stage did not run — say that; never silently print nothing.
 *
 * @param {{prompt: object}} ctx the wizard ctx (its prompt does the printing)
 * @param {object} state the final flow state (reads `errors_summary`)
 * @param {{exists?: (p: string) => boolean}} [seams] test seam for the fs check
 * @returns {object|null} the summary when it was printed, null when absent
 */
export function renderExitVerdict(ctx, state, { exists = existsSync } = {}) {
  const summary = state?.errors_summary;
  if (!summary || typeof summary !== "object" || typeof summary.path !== "string" || !exists(summary.path)) {
    ctx.prompt.warn("The errors stage did not run — no errors.logs exists for this run, so its absence is NOT a clean bill of health.");
    return null;
  }
  if (summary.ok === false) {
    ctx.prompt.warn(`errors consolidation partially failed (${summary.error ?? "unknown"}) — partial detail: ${summary.path}`);
    return summary;
  }
  const detail = `Full detail: ${summary.path}`;
  const blocked = summary.blockedRepos?.length ?? 0;
  const code = summary.codeRepos?.length ?? 0;
  const total = summary.totalRepos ?? 0;
  switch (summary.verdict) {
    case "clean": {
      // One quiet line — do not make success noisy. A rescued step (0066/D1) is
      // still a clean run; it earns a clause, never an alarm.
      const degraded = summary.degraded ?? 0;
      const note = degraded > 0 ? ` (${degraded} step${degraded === 1 ? "" : "s"} succeeded via a fallback — see "Degraded")` : "";
      ctx.prompt.info(`No errors recorded${note} — ${summary.path}`);
      break;
    }
    case "environment":
      ctx.prompt.warn(`Environment blocked this run — ${summary.remedy ?? "a required service is down"}`);
      ctx.prompt.warn(`   ${blocked} of ${total} repos blocked by the environment. 0 code-attributable failures.`);
      ctx.prompt.warn(`   ${detail}`);
      break;
    case "code":
      ctx.prompt.error(`${code} of ${total} repos carry a code-attributable failure.`);
      ctx.prompt.error(`   ${detail}`);
      break;
    case "mixed":
      // The code failure leads — it will not resolve itself when Docker starts.
      ctx.prompt.error(`${code} of ${total} repos carry a code-attributable failure (listed first in the ledger).`);
      ctx.prompt.warn(`   ${blocked} more blocked by the environment — ${summary.remedy ?? "a required service is down"}`);
      ctx.prompt.warn(`   ${detail}`);
      break;
    default:
      ctx.prompt.info(detail);
      break;
  }
  return summary;
}

/**
 * The exit-code contract (documented in harness-repo-package-remediation/docs/env.md):
 *   0 — clean run, or a run whose only failures are ENVIRONMENTAL and
 *       correctly reported `blocked`. The pipeline did its job: it told the
 *       truth. (A non-zero here would break every CI wrapper the moment a
 *       registry hiccups — the over-correction that leads to `|| true`, which
 *       destroys the signal permanently.)
 *   1 — code-attributable failures exist (`code`/`mixed`), or the flow itself
 *       did not complete. "Did the work actually happen" is a DIFFERENT
 *       question and belongs to a future --fail-on-blocked flag, not here.
 * `null` means the errors stage produced no verdict — the caller falls back to
 * its legacy exit rule.
 * @param {object|null} summary the printed errors summary
 * @returns {0|1|null}
 */
export function verdictExitCode(summary) {
  if (!summary || summary.ok === false || typeof summary.verdict !== "string") return null;
  return summary.verdict === "code" || summary.verdict === "mixed" ? 1 : 0;
}

/**
 * Map the first failing `issue.path` to the wizard step id that owns it, using
 * an explicit prefix table over the offending node's id (resolved via config)
 * plus the raw path. Unknown paths fall back to the input-file step.
 * @param {string|undefined} issuePath e.g. "nodes[3].with.column"
 * @param {object} [config] the loaded flow config (to resolve node index → id)
 * @returns {string} a wizard step id
 */
export function mapIssueToStep(issuePath, config) {
  if (!issuePath) return "input-file";
  let haystack = issuePath;
  const m = issuePath.match(/^nodes\[(\d+)\]/);
  const node = m && config?.nodes?.[Number(m[1])];
  if (node?.id) haystack = `${node.id} ${issuePath}`;
  if (node?.uses) haystack += ` ${node.uses}`;

  // 0021/A3.4 — a bad ingest selection re-routes to the new first step, not to
  // `input-file`. Checked BEFORE the generic ingest/path rule below, whose
  // `/ingest/` would otherwise swallow every issue on the orchestrator node.
  if (/ingest_source|ingest_ref|\bmap_in\b|\bmap_out\b/i.test(haystack)) return "ingest-source";
  if (/select_headers|selected_headers|\bcolumns\b/i.test(haystack)) return "header-select";
  if (/collect_repos|repo_column|\brepos\b|\bcolumn\b/i.test(haystack)) return "repo-column";
  if (/render|out_dir|output|filename|report/i.test(haystack)) return "output";
  if (/mapping|uses|pattern/i.test(haystack)) return "mapping";
  if (/ingest|input|path|rows/i.test(haystack)) return "input-file";
  return "input-file";
}
