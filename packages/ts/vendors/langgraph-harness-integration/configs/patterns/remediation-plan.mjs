/**
 * commands.remediationPlan — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the deterministic
 * remediation PLAN stage (langgraph-flow.md capability 4a). For each
 * fingerprinted repo it joins the CAPTURED evidence (fingerprint + extracted
 * dependencies) with the INPUTTED vulnerability data (the dataset rows matched to
 * that repo) into a stable, ordered plan — one action per actionable finding,
 * each tagged with the strategy and the language-specific tool selected from the
 * central tool registry (harness-repo-package-remediation/tools/), plus the SKILL referenced from the
 * central skill registry (harness-repo-package-remediation/skills/).
 *
 * The plan is PURE + DETERMINISTIC (join + selection only, no network / model /
 * clock — src/remediation-plan-lib.mjs), so it behaves identically under `--mock`
 * and on real runs; the dataset (the inputted vulnerability data) is real in both
 * modes, so the plan carries real CVEs/packages/target-versions even under mock.
 * It runs BEFORE `skills.optimizePrompt` (which reviews this plan and emits the
 * optimized SDK prompt) and BEFORE `commands.repoRemediate` (which executes it).
 *
 * Registries are DATA (harness-repo-package-remediation/tools/, harness-repo-package-remediation/skills/), loaded through the SDK
 * seam re-exports (src/sdk.mjs) — never imported as atom modules, so the pack
 * trust boundary is untouched. `tools_dir` / `skills_dir` are optional overrides
 * (resolved against the flow dir); the loaders otherwise resolve module-relative.
 */

import { isAbsolute, resolve } from "node:path";

import { loadToolRegistry, toolsForEcosystem, loadSkillRegistry } from "../../src/sdk.mjs";
import { normalizeRepoUrl } from "../../src/repo-url.mjs";
import { ecosystemGroup } from "../../src/ecosystem-registry.mjs";
import { buildRepoPlan } from "../../src/remediation-plan-lib.mjs";

export const meta = {
  name: "commands.remediationPlan",
  category: "commands",
  summary:
    "Deterministic per-repo remediation plan from captured fingerprints + inputted vulnerability data; selects language-specific tools + a skill from the central registries.",
  params: {
    type: "object",
    required: ["fingerprints_from", "dataset_from", "into"],
    properties: {
      fingerprints_from: { type: "string", minLength: 1 },
      dataset_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      // optional central-registry directory overrides (resolved against flow dir)
      tools_dir: { type: "string" },
      skills_dir: { type: "string" },
    },
  },
  returns: "node",
};

/** Test seam: build the factory over injected registries (else load real ones). */
export function _remediationPlanWith({ toolRegistry = null, skillRegistry = null } = {}) {
  return function remediationPlanFactory(params, ctx) {
    // Registries load once per compiled node, on the first invocation, regardless
    // of mock — a broken registry surfaces immediately, and the plan is real even
    // offline (the dataset is the source of the vulnerability data).
    let tools = toolRegistry;
    let skills = skillRegistry;
    return async (state) => {
      if (tools === null) {
        const dir = params.tools_dir ? (isAbsolute(params.tools_dir) ? params.tools_dir : resolve(ctx.options.baseDir, params.tools_dir)) : undefined;
        tools = loadToolRegistry(dir);
      }
      if (skills === null) {
        const dir = params.skills_dir ? (isAbsolute(params.skills_dir) ? params.skills_dir : resolve(ctx.options.baseDir, params.skills_dir)) : undefined;
        skills = loadSkillRegistry(dir);
      }
      const skillNames = skills.skills.map((s) => s.name);

      const entries = Array.isArray(state[params.fingerprints_from]) ? state[params.fingerprints_from] : [];
      const dataset = state[params.dataset_from] ?? {};
      const rows = Array.isArray(dataset.rows) ? dataset.rows : [];

      const plans = [];
      const total = entries.length;
      let index = 0;
      for (const entry of entries) {
        index += 1;
        ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });

        const url = entry?.url ?? null;
        const normalizedUrl = normalizeRepoUrl(url ?? "");
        const matchedRows = normalizedUrl === null
          ? []
          : rows.filter((row) => normalizeRepoUrl(String(row?.repo_url ?? "")) === normalizedUrl);

        // Select the ecosystem's tools AFTER we know the group — but the group is
        // computed inside buildRepoPlan, so pass the union of every group's tools
        // and let the lib filter by the resolved group. `toolsForEcosystem` over
        // all known groups, deduped, gives the lib the full candidate set.
        const allTools = tools.tools;
        const plan = buildRepoPlan({
          url,
          dir: entry?.dir ?? null,
          fingerprint: entry?.fingerprint ?? null,
          dependencies: Array.isArray(entry?.dependencies) ? entry.dependencies : [],
          cloneError: typeof entry?.cloneError === "string" ? entry.cloneError : null,
          rows: matchedRows,
          tools: allTools,
          skillNames,
          ecosystemGroup,
        });
        // Narrow the plan's advertised tool list to the resolved ecosystem (the
        // full set stays available to the lib for selection; the plan surfaces
        // only what applies to this repo's language).
        plan.tools = toolsForEcosystem(tools, plan.ecosystem).map((t) => t.id);
        plans.push(plan);
      }
      return { [params.into]: plans };
    };
  };
}

export const remediationPlan = _remediationPlanWith({});
