/**
 * commands.remediationReport — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the remediation-report
 * stage (langgraph-flow.md capability 7 — "generate remediation reports"). It
 * joins, per repo, the plan (capability 4), the optimized prompt, the executed
 * remediations (capability 5), and the outcome classification (capability 6) into
 * one markdown report per repo AND a single aggregate JSON, written under the
 * session artifact root.
 *
 * Deterministic: the markdown is a pure function of the input channels
 * (`renderRepoMarkdown`), so two runs over the same state produce byte-identical
 * reports. Respects `ctx.options.dryRun` (no write, like `commands.renderReport`);
 * otherwise it writes even under `--mock`, because the reports ARE the deliverable
 * (the same way `fingerprints.json` / `integrated.json` are written under mock).
 *
 * Trust boundary: lives under `configs/patterns/`; imports only the pack's own
 * `src/` bridges. `out_dir` resolves against the flow dir — never a host-absolute
 * path in yaml.
 */

import { basename, isAbsolute, join, resolve } from "node:path";

import { writeFileAtomic } from "../../src/sdk.mjs";
import { normalizeRepoUrl } from "../../src/repo-url.mjs";

export const meta = {
  name: "commands.remediationReport",
  category: "commands",
  summary:
    "Join plan + optimized prompt + remediations + validation per repo into one markdown report each plus an aggregate JSON, written under the session root.",
  params: {
    type: "object",
    required: ["validations_from", "out_dir", "into"],
    properties: {
      plans_from: { type: "string" },
      optimized_prompts_from: { type: "string" },
      remediations_from: { type: "string" },
      validations_from: { type: "string", minLength: 1 },
      tests_from: { type: "string" },
      builds_from: { type: "string" },
      out_dir: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

/** Filesystem-safe slug for a repo: the clone basename, else the url tail. */
export function repoSlug(url, dir) {
  if (typeof dir === "string" && dir.length > 0) return basename(dir);
  const norm = normalizeRepoUrl(String(url ?? "")) ?? String(url ?? "");
  const cleaned = norm.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/[^a-zA-Z0-9]+/g, "__").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "unknown";
}

const table = (headers, rows) => {
  if (rows.length === 0) return "_none_\n";
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c) => (c == null || c === "" ? "—" : String(c))).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
};

/**
 * Render one repo's markdown report from its joined bundle. Pure.
 * @param {{plan: object|null, prompt: object|null, remediations: object[], validation: object|null}} bundle
 */
export function renderRepoMarkdown({ plan, prompt, remediations = [], validation }) {
  const url = plan?.url ?? validation?.url ?? (remediations[0]?.repo ?? null);
  const eco = plan?.ecosystem ?? validation?.ecosystem ?? "unknown";
  const out = [];
  out.push(`# Remediation report — ${url ?? "unknown repo"}`);
  out.push("");
  out.push(`- **Ecosystem:** ${eco}`);
  out.push(`- **Overall outcome:** ${validation?.overall ?? "n/a"}`);
  out.push(`- **Skill referenced:** ${plan?.skill ?? "n/a"}`);
  out.push(`- **Tools available:** ${(plan?.tools ?? []).join(", ") || "n/a"}`);
  if (plan?.cloneError) out.push(`- **Clone error:** ${plan.cloneError}`);
  out.push("");

  const vulns = Array.isArray(plan?.vulnerabilities) ? plan.vulnerabilities : [];
  out.push(`## Vulnerabilities (${vulns.length})`);
  out.push(table(
    ["package", "severity", "CVE", "scope", "current", "recommended"],
    vulns.map((v) => [v.package, v.severity, v.cveId, v.scope, v.currentVersion, v.recommendedVersion]),
  ));
  out.push("");

  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  out.push(`## Deterministic plan (${actions.length} action${actions.length === 1 ? "" : "s"})`);
  if (actions.length === 0) out.push("_no actions_\n");
  else out.push(`${actions.map((a, i) => `${i + 1}. [${(a.severity ?? "unknown").toUpperCase()}] ${a.strategy} \`${a.package}\` ${a.from ?? "?"}→${a.to ?? "latest"} via \`${a.tool}\`${a.cveId ? ` (${a.cveId})` : ""}`).join("\n")}\n`);
  out.push("");

  out.push("## Optimized SDK prompt");
  out.push(`> source: ${prompt?.source ?? "n/a"}${prompt?.rationale ? ` — ${prompt.rationale}` : ""}`);
  out.push("");
  out.push("```text");
  out.push(prompt?.prompt ?? "(no optimized prompt)");
  out.push("```");
  out.push("");

  out.push(`## Remediation results (${remediations.length})`);
  out.push(table(
    ["package", "applied", "from", "to", "source", "skip reason"],
    remediations.map((r) => [r.package, r.applied ? "yes" : "no", r.from, r.to, r.source, r.skipReason]),
  ));
  out.push("");

  const o = validation?.outcomes ?? { fixed: 0, broken: 0, blocked: 0, skipped: 0, bug: 0 };
  out.push("## Outcome ledger");
  out.push(`- **fixed:** ${o.fixed} · **broken:** ${o.broken} · **blocked:** ${o.blocked} · **skipped:** ${o.skipped} · **bug:** ${o.bug}`);
  out.push("");
  const st = validation?.stages ?? {};
  out.push("## Stage results");
  out.push(`- install-verify: ${st.installVerify ?? "n/a"} · build: ${st.build ?? "n/a"} · test: ${st.test ?? "n/a"}`);
  out.push("");
  return out.join("\n");
}

export function remediationReport(params, ctx) {
  return async (state) => {
    const plans = params.plans_from && Array.isArray(state[params.plans_from]) ? state[params.plans_from] : [];
    const prompts = params.optimized_prompts_from && Array.isArray(state[params.optimized_prompts_from]) ? state[params.optimized_prompts_from] : [];
    const remediations = params.remediations_from && Array.isArray(state[params.remediations_from]) ? state[params.remediations_from] : [];
    const validations = Array.isArray(state[params.validations_from]) ? state[params.validations_from] : [];

    const keyOf = (u) => normalizeRepoUrl(String(u ?? ""));
    const planByUrl = new Map();
    for (const p of plans) planByUrl.set(keyOf(p?.url), p);
    const promptByUrl = new Map();
    for (const p of prompts) promptByUrl.set(keyOf(p?.url ?? p?.repo), p);
    const remByUrl = new Map();
    for (const r of remediations) {
      const k = keyOf(r?.repo);
      if (!remByUrl.has(k)) remByUrl.set(k, []);
      remByUrl.get(k).push(r);
    }

    const outDir = isAbsolute(params.out_dir) ? params.out_dir : resolve(ctx.options.baseDir, params.out_dir);
    const reportsDir = join(outDir, "reports");

    const reports = [];
    const total = validations.length;
    let index = 0;
    for (const validation of validations) {
      index += 1;
      ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });
      const k = keyOf(validation?.url);
      const plan = planByUrl.get(k) ?? null;
      const prompt = promptByUrl.get(k) ?? null;
      const reps = remByUrl.get(k) ?? [];
      const slug = repoSlug(validation?.url, plan?.dir);
      const markdown = renderRepoMarkdown({ plan, prompt, remediations: reps, validation });
      const target = join(reportsDir, `${slug}.md`);
      if (ctx.options.dryRun) {
        reports.push({ repo: validation?.url ?? null, slug, path: target, written: false, dry_run: true, overall: validation?.overall ?? null });
      } else {
        await writeFileAtomic(target, markdown);
        reports.push({ repo: validation?.url ?? null, slug, path: target, written: true, bytes: Buffer.byteLength(markdown), overall: validation?.overall ?? null });
      }
    }

    // Aggregate JSON — the machine-readable roll-up of every capability channel.
    const aggregate = {
      generatedFor: reports.length,
      totals: validations.reduce(
        (acc, v) => {
          const o = v?.outcomes ?? {};
          for (const k of ["fixed", "broken", "blocked", "skipped", "bug"]) acc[k] += o[k] ?? 0;
          return acc;
        },
        { fixed: 0, broken: 0, blocked: 0, skipped: 0, bug: 0 },
      ),
      plans,
      optimized_prompts: prompts,
      remediations,
      validations,
      reports,
    };
    const aggregatePath = join(outDir, "remediation-report.json");
    let aggregateWritten = false;
    if (!ctx.options.dryRun) {
      await writeFileAtomic(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`);
      aggregateWritten = true;
    }

    return { [params.into]: { reports, aggregate: { path: aggregatePath, written: aggregateWritten }, totals: aggregate.totals } };
  };
}
