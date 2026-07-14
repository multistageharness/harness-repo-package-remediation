/**
 * nodes.llm — the generic LLM node: prompt + input channels → output channel,
 * optionally schema-constrained. skills.* atoms are specializations; this is
 * the bare seam for one-off reasoning steps.
 */

import { callLlm, gatherInput, resolvePrompt, resolveSchema } from "../skills/_skill-base.mjs";

export const meta = {
  name: "nodes.llm",
  category: "nodes",
  summary: "Generic LLM node: prompt + inputs → (structured) output channel.",
  params: {
    type: "object",
    required: ["out"],
    properties: {
      model: { type: "string" },
      temperature: { type: "number", minimum: 0, maximum: 2 },
      prompt: { type: "string" },
      prompt_uses: { type: "string" },
      prompt_with: { type: "object" },
      system: { type: "string" },
      user: { type: "string" },
      input: { type: "object" },
      schema: true,
      out: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function llm(params, ctx) {
  const promptReady = resolvePrompt(params, ctx);
  return async (state) => {
    const prompt = await promptReady;
    const vars = gatherInput(params.input, state);
    const { system, user } = await prompt(vars);
    const schema = resolveSchema(params.schema ?? ctx.node?.validate?.schema, ctx);
    const result = await callLlm(ctx, {
      nodeId: ctx.node?.id,
      system,
      user,
      schema,
      model: params.model,
      temperature: params.temperature,
    });
    if (schema) {
      if (result.structured === undefined) {
        throw new Error(`nodes.llm: structured output expected but not parseable (${result.parse_error ?? "no JSON found"})`);
      }
      return { [params.out]: result.structured };
    }
    return { [params.out]: result.content };
  };
}
