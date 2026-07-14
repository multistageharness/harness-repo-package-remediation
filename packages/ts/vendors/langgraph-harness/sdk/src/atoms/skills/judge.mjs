/**
 * skills.judge — A-vs-B verdict with rationale (llm-as-judge). Writes the
 * structured verdict {winner, rationale, scores} into `out`.
 */

import { callLlm, gatherInput, resolvePrompt } from "./_skill-base.mjs";

export const meta = {
  name: "skills.judge",
  category: "skills",
  summary: "LLM-as-judge: compare channel A vs channel B on criteria → verdict channel.",
  params: {
    type: "object",
    required: ["a_from", "b_from", "out"],
    properties: {
      model: { type: "string" },
      prompt: { type: "string" },
      prompt_uses: { type: "string" },
      prompt_with: { type: "object" },
      a_from: { type: "string", minLength: 1 },
      b_from: { type: "string", minLength: 1 },
      criteria: { type: "string" },
      out: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

const VERDICT_SCHEMA = {
  type: "object",
  required: ["winner", "rationale"],
  properties: {
    winner: { enum: ["a", "b", "tie"] },
    rationale: { type: "string" },
    score_a: { type: "number", minimum: 0, maximum: 10 },
    score_b: { type: "number", minimum: 0, maximum: 10 },
  },
};

export function judge(params, ctx) {
  const hasCustomPrompt = params.prompt || params.prompt_uses;
  const promptReady = hasCustomPrompt
    ? resolvePrompt(params, ctx)
    : resolvePrompt(
        {
          system: `You are an impartial judge. Compare candidate A and candidate B${params.criteria ? ` on: ${params.criteria}` : ""}. Pick a winner or declare a tie.`,
          user: "## Candidate A\n{{a}}\n\n## Candidate B\n{{b}}",
        },
        ctx,
      );
  return async (state) => {
    const prompt = await promptReady;
    const vars = gatherInput({ a: params.a_from, b: params.b_from }, state);
    const { system, user } = await prompt(vars);
    const result = await callLlm(ctx, { nodeId: ctx.node?.id, system, user, schema: VERDICT_SCHEMA, model: params.model });
    if (result.structured === undefined) {
      throw new Error(`skills.judge: no parseable verdict (${result.parse_error ?? "no JSON found"})`);
    }
    return { [params.out]: result.structured };
  };
}
