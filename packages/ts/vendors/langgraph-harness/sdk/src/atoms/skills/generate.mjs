/**
 * skills.generate — the general reasoning skill: prompt + state inputs →
 * prose or (schema-constrained) structured output into `out`.
 */

import { callLlm, gatherInput, resolvePrompt, resolveSchema } from "./_skill-base.mjs";

export const meta = {
  name: "skills.generate",
  category: "skills",
  summary: "LLM generation: prompt + input channels → prose or structured output channel.",
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

export function generate(params, ctx) {
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
        throw new Error(`skills.generate: structured output expected but not parseable (${result.parse_error ?? "no JSON found"})`);
      }
      return { [params.out]: result.structured };
    }
    return { [params.out]: result.content };
  };
}
