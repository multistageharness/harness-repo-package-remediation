/**
 * skills.summarize — condense one or more channels into a bounded summary.
 * A specialization of generate with a built-in system contract.
 */

import { callLlm, gatherInput, resolvePrompt } from "./_skill-base.mjs";

export const meta = {
  name: "skills.summarize",
  category: "skills",
  summary: "LLM summary of input channels into a bounded prose channel.",
  params: {
    type: "object",
    required: ["input", "out"],
    properties: {
      model: { type: "string" },
      prompt: { type: "string" },
      prompt_uses: { type: "string" },
      prompt_with: { type: "object" },
      input: { type: "object" },
      max_words: { type: "integer", minimum: 10, maximum: 2000 },
      out: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function summarize(params, ctx) {
  const hasCustomPrompt = params.prompt || params.prompt_uses;
  const promptReady = hasCustomPrompt
    ? resolvePrompt(params, ctx)
    : resolvePrompt(
        {
          system: `You are a precise technical summarizer. Summarize the material in at most ${params.max_words ?? 150} words. Keep concrete identifiers.`,
          user: "{{__material}}",
        },
        ctx,
      );
  return async (state) => {
    const prompt = await promptReady;
    const vars = gatherInput(params.input, state);
    if (!hasCustomPrompt) {
      vars.__material = Object.entries(vars)
        .map(([k, v]) => `## ${k}\n${v}`)
        .join("\n\n");
    }
    const { system, user } = await prompt(vars);
    const result = await callLlm(ctx, { nodeId: ctx.node?.id, system, user, model: params.model });
    return { [params.out]: result.content };
  };
}
