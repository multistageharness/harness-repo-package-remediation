/**
 * commands.applyPackageRules — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the package-rules stage
 * (change record 0032/D5 + A7; next-steps NS2). Sits between `plan` and
 * `remediate` and turns the declarative rule list into PER-ACTION verdicts and
 * config fields, so the mutating executor consumes already-decided actions
 * instead of evaluating policy inline (0032/A7 relocates the gate that lived
 * at repo-remediate.mjs:267-281).
 *
 * v1 field surface (grown from the 0019/D3 allow/skip engine, same tri-state
 * matchers + first-match-wins semantics — a WIDEN, not a parallel system):
 *   · `policy`        — { allowed, skipReason, ruleIndex } stamped per action
 *   · `rangeStrategy` — the constraint-rewrite verb `getNewValue` consumes
 *                       (0032/A5); `default_range_strategy` param, "auto".
 * Future rules (matchUpdateTypes, minimumReleaseAge/cooldown H6, per-severity
 * targets H2) land HERE as new matcher dimensions + fields — never in the
 * executor.
 *
 * PURE over state (the policy file read + optional decision log are its only
 * I/O): identical evaluation under `--mock` and real runs; the policy loads on
 * first invocation REGARDLESS of mock so a broken file fails loudly (Epic 04
 * discipline). Decision lines (0032/D1) record each verdict — including the
 * plan's candidacy on the plan stage's behalf, which stays pure by prior
 * commitment.
 */

import { isAbsolute, resolve } from "node:path";

import { normalizeRepoUrl } from "../../src/repo-url.mjs";
import { createDecisionLogger } from "../../src/decision-log.mjs";
import { loadPolicy, applyPolicyRules } from "../policy/apply-policy.mjs";
import { MATCHERS } from "../policy/matchers/index.mjs";

export const meta = {
  name: "commands.applyPackageRules",
  category: "commands",
  summary: "Stamp each plan action with its declarative policy verdict + package-rules config (rangeStrategy) — the decided-actions seam the remediate executor consumes.",
  params: {
    type: "object",
    required: ["plans_from", "into"],
    properties: {
      plans_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      fingerprints_from: { type: "string" },
      policy_path: { type: "string" },
      decision_log: { type: "string" },
      default_range_strategy: { type: "string" },
    },
  },
  returns: "node",
};

export function applyPackageRules(params, ctx) {
  let policyRules = null;
  let logger = null;
  return async (state) => {
    if (policyRules === null) {
      const policyRel = params.policy_path ?? "../policy/remediation-policy.yaml";
      policyRules = await loadPolicy(isAbsolute(policyRel) ? policyRel : resolve(ctx.options.baseDir, policyRel));
    }
    if (logger === null) {
      const logRel = params.decision_log ?? null;
      logger = createDecisionLogger({
        path: logRel === null ? null : isAbsolute(logRel) ? logRel : resolve(ctx.options.baseDir, logRel),
        mock: ctx.options.mock === true,
        stage: "package-rules",
      });
    }
    const plans = Array.isArray(state[params.plans_from]) ? state[params.plans_from] : [];
    const fingerprints = Array.isArray(state[params.fingerprints_from]) ? state[params.fingerprints_from] : [];
    const fpByUrl = new Map();
    for (const entry of fingerprints) {
      const key = normalizeRepoUrl(entry?.url ?? "");
      if (key !== null && !fpByUrl.has(key)) fpByUrl.set(key, entry);
    }
    const rangeStrategy = typeof params.default_range_strategy === "string" && params.default_range_strategy.length > 0 ? params.default_range_strategy : "auto";

    const ruled = [];
    const total = plans.length;
    let index = 0;
    for (const plan of plans) {
      index += 1;
      ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });
      const normalizedUrl = normalizeRepoUrl(plan?.url ?? "");
      const entry = normalizedUrl !== null ? fpByUrl.get(normalizedUrl) ?? null : null;
      const dependencies = Array.isArray(entry?.dependencies) ? entry.dependencies : [];
      const dominant = entry?.fingerprint?.dominantEcosystem ?? null;
      const dominantEntry = Array.isArray(entry?.fingerprint?.ecosystems)
        ? entry.fingerprint.ecosystems.find((e) => e?.id === dominant)
        : null;

      const actions = Array.isArray(plan?.actions) ? plan.actions : [];
      const ruledActions = [];
      for (const action of actions) {
        const pkg = typeof action?.package === "string" ? action.package : null;
        const dep = pkg !== null ? dependencies.find((d) => d?.name === pkg) ?? null : null;
        const verdict = applyPolicyRules(
          {
            repoUrl: normalizedUrl,
            dominantEcosystem: dominant,
            confidenceBucket: dominantEntry?.confidenceBucket ?? null,
            depType: dep?.depType ?? null,
            package: pkg,
          },
          policyRules,
          MATCHERS,
        );
        const ruleIndex = verdict.rule === null ? null : policyRules.indexOf(verdict.rule);
        // candidacy line on the (pure) plan stage's behalf, then the verdict
        await logger.log({ decision: "candidacy", repo: plan?.url ?? null, package: pkg, source: "plan", strategy: action?.strategy ?? null, manifest: action?.manifest ?? null });
        await logger.log({ decision: "policy", repo: plan?.url ?? null, package: pkg, allowed: verdict.allowed, skipReason: verdict.skipReason ?? null, ruleIndex });
        ruledActions.push({
          ...action,
          policy: { allowed: verdict.allowed, skipReason: verdict.skipReason ?? null, ruleIndex },
          rangeStrategy: action?.rangeStrategy ?? rangeStrategy,
        });
      }
      ruled.push({ ...plan, actions: ruledActions });
    }
    return { [params.into]: ruled };
  };
}
