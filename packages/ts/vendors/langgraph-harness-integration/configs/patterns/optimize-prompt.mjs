/**
 * skills.optimizePrompt — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the LLM prompt-optimizer
 * stage (langgraph-flow.md capability 4b). For each deterministic per-repo plan
 * (from `commands.remediationPlan`) it has the model REVIEW the dataset + plan
 * and generate an OPTIMIZED remediation prompt that can be handed to the SDK
 * remediation agent — with the language-specific tools selected for that repo.
 *
 * SKILLS ARE LOADED / REFERENCED BY THE SDK (capability 3): the plan names a
 * SKILL (npm-remediation / pip-remediation / …). This atom loads that skill's
 * body from the central skill registry (harness-repo-package-remediation/skills/) through the SDK seam and
 * seeds the model's SYSTEM prompt with it — the reviewable Skill IS the reusable
 * instruction the SDK feeds the model.
 *
 * Seam rule: the model is reached ONLY via `ctx.llm.invoke({system, user,
 * schema})` — never a provider SDK import; `llm.call`/`llm.result` events mirror
 * the SDK's skill atoms. Credentials stay env-only at that seam.
 *
 * Mock seam (offline acceptance contract, mirroring skills.detectSetup): under
 * `ctx.options.mock`, or for a mock-provider reply (the silent no-credentials
 * fallback, `result.mode === "mock"`), the atom returns a DETERMINISTIC prompt
 * CONSTRUCTED from the plan (`buildDeterministicPrompt`) — a genuinely usable
 * optimized prompt, not a schema skeleton — with `source: "deterministic"`. Only
 * the degrade path (real model, unusable reply) keeps the constructed prompt AND
 * records a finding, so a real scan's failure stays distinguishable.
 */

import { callLlm, validateSchema, readSkillBody, loadSkillRegistry } from "../../src/sdk.mjs";
import { isAbsolute, resolve } from "node:path";

export const meta = {
  name: "skills.optimizePrompt",
  category: "skills",
  summary:
    "LLM-review each deterministic remediation plan → an optimized SDK remediation prompt with language-specific tools; deterministic constructed prompt under mock.",
  params: {
    type: "object",
    required: ["plans_from", "into"],
    properties: {
      plans_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      skills_dir: { type: "string" },
      model: { type: "string" },
    },
  },
  returns: "node",
};

export const OPTIMIZED_SCHEMA = {
  type: "object",
  required: ["prompt"],
  properties: {
    prompt: { type: "string", minLength: 1 },
    recommendedTools: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
};

const SYSTEM_PREAMBLE =
  "You are a dependency-remediation prompt engineer. Given a repository's deterministic remediation plan and its vulnerability dataset, write a single, precise instruction (the 'prompt') for a language-specific remediation agent that will apply the fixes with the listed tools. Be concrete about package, version, strategy, and tool per finding. Do not invent versions.";

const SEVERITY_LABEL = (s) => (typeof s === "string" && s.length > 0 ? s.toUpperCase() : "UNKNOWN");

/**
 * The deterministic, genuinely-usable optimized prompt CONSTRUCTED from a plan —
 * used under mock, mock-provider, and the degrade path. Pure (no I/O).
 * @param {object} plan a remediationPlan record
 * @returns {string}
 */
export function buildDeterministicPrompt(plan) {
  const repo = plan?.repo ?? plan?.url ?? "the repository";
  const eco = plan?.ecosystem ?? "unknown";
  const tools = Array.isArray(plan?.tools) ? plan.tools : [];
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const lines = [];
  lines.push(`You are the ${eco} remediation agent for repository ${repo}.`);
  if (actions.length === 0) {
    lines.push("There are no actionable dependency findings for this repository. Verify the manifests and report 'no remediation required'.");
  } else {
    lines.push(`Apply the following ${actions.length} dependency fix${actions.length === 1 ? "" : "es"} using only these tools: ${tools.join(", ") || "manifest-edit"}.`);
    actions.forEach((a, i) => {
      const target = a.to ? `to ${a.to}` : "to the latest patched version from the registry";
      const from = a.from ? ` from ${a.from}` : "";
      const cve = a.cveId ? ` (${a.cveId})` : "";
      lines.push(`${i + 1}. [${SEVERITY_LABEL(a.severity)}] ${a.strategy === "transitive-pin" ? "Pin transitive" : "Bump"} ${a.package}${from} ${target}${cve} using the ${a.tool} tool.`);
    });
  }
  lines.push(`Follow the ${plan?.skill ?? "remediation-planning"} skill. Preserve manifest formatting, avoid breaking major upgrades, and report each fix as fixed / failed / skipped with a reason.`);
  return lines.join("\n");
}

/** Build the model user prompt from the plan (bounded, structured). */
export function buildUserPrompt(plan) {
  const summary = {
    repo: plan?.repo ?? plan?.url ?? null,
    ecosystem: plan?.ecosystem ?? null,
    skill: plan?.skill ?? null,
    availableTools: Array.isArray(plan?.tools) ? plan.tools : [],
    actions: (Array.isArray(plan?.actions) ? plan.actions : []).map((a) => ({
      package: a.package,
      severity: a.severity,
      strategy: a.strategy,
      from: a.from,
      to: a.to,
      tool: a.tool,
      cveId: a.cveId,
    })),
  };
  return `Repository remediation plan (review and produce an optimized agent prompt):\n${JSON.stringify(summary, null, 2)}`;
}

/** Assemble one optimized-prompt record. */
function record(plan, { prompt, recommendedTools, rationale, source, findings = [] }) {
  return {
    repo: plan?.repo ?? plan?.url ?? null,
    url: plan?.url ?? null,
    ecosystem: plan?.ecosystem ?? null,
    skill: plan?.skill ?? null,
    tools: Array.isArray(plan?.tools) ? plan.tools : [],
    recommendedTools: Array.isArray(recommendedTools) ? recommendedTools : Array.isArray(plan?.tools) ? plan.tools : [],
    actionCount: Array.isArray(plan?.actions) ? plan.actions.length : 0,
    prompt,
    rationale: typeof rationale === "string" ? rationale : null,
    source,
    findings,
  };
}

/** Test seam: build the factory over an injected skill registry (else load real). */
export function _optimizePromptWith({ skillRegistry = null } = {}) {
  return function optimizePromptFactory(params, ctx) {
    let skills = skillRegistry;
    return async (state) => {
      if (skills === null) {
        const dir = params.skills_dir ? (isAbsolute(params.skills_dir) ? params.skills_dir : resolve(ctx.options.baseDir, params.skills_dir)) : undefined;
        skills = loadSkillRegistry(dir);
      }
      const plans = Array.isArray(state[params.plans_from]) ? state[params.plans_from] : [];
      const optimized = [];
      const total = plans.length;
      let index = 0;
      for (const plan of plans) {
        index += 1;
        ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });

        // Load the referenced skill body — the reusable instruction the SDK seeds.
        const skillBody = readSkillBody(skills, plan?.skill);
        const system = skillBody ? `${SYSTEM_PREAMBLE}\n\n---\n${skillBody}` : SYSTEM_PREAMBLE;

        // Mock: pure, deterministic constructed prompt — no seam call.
        if (ctx.options.mock) {
          optimized.push(record(plan, { prompt: buildDeterministicPrompt(plan), source: "deterministic" }));
          continue;
        }

        const user = buildUserPrompt(plan);
        // 0062/A4 — through the SDK's own `callLlm` helper (emit → invoke → emit),
        // the same one the platform's built-in skills atoms use.
        const result = await callLlm(ctx, {
          nodeId: ctx.node?.id,
          system,
          user,
          schema: OPTIMIZED_SCHEMA,
          model: params.model,
        });

        // Mock-provider reply (no-credentials fallback) → constructed prompt.
        if (result.mode === "mock") {
          optimized.push(record(plan, { prompt: buildDeterministicPrompt(plan), source: "deterministic" }));
          continue;
        }

        const structured = result.structured;
        if (structured === undefined || validateSchema(structured, OPTIMIZED_SCHEMA).length > 0) {
          // Degrade, never guess: keep the deterministic prompt, record the failure.
          optimized.push(record(plan, {
            prompt: buildDeterministicPrompt(plan),
            source: "deterministic",
            findings: [{ severity: "minor", note: `model reply unusable (${result.parse_error ?? "schema mismatch"}) — fell back to the deterministic prompt` }],
          }));
          continue;
        }

        optimized.push(record(plan, {
          prompt: structured.prompt,
          recommendedTools: structured.recommendedTools,
          rationale: structured.rationale,
          source: "llm",
        }));
      }
      return { [params.into]: optimized };
    };
  };
}

export const optimizePrompt = _optimizePromptWith({});
