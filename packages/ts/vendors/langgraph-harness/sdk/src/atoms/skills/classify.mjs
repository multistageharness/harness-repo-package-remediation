/**
 * skills.classify — text → one of `labels` (+ confidence + rationale).
 * The label lands in `out` (a plain string channel, ready for a switch
 * edge); the full verdict lands in `out_detail` when declared.
 */

import { callLlm, gatherInput, resolvePrompt } from "./_skill-base.mjs";

export const meta = {
  name: "skills.classify",
  category: "skills",
  summary: "LLM classification into an enum of labels; label → out, verdict → out_detail.",
  params: {
    type: "object",
    required: ["labels", "out"],
    properties: {
      model: { type: "string" },
      prompt: { type: "string" },
      prompt_uses: { type: "string" },
      prompt_with: { type: "object" },
      system: { type: "string" },
      user: { type: "string" },
      input: { type: "object" },
      labels: { type: "array", minItems: 2, items: { type: "string" } },
      out: { type: "string", minLength: 1 },
      out_detail: { type: "string" },
    },
  },
  returns: "node",
};

export function classify(params, ctx) {
  const promptReady = resolvePrompt(params, ctx);
  const schema = {
    type: "object",
    required: ["label", "confidence"],
    properties: {
      label: { enum: params.labels },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      rationale: { type: "string" },
    },
  };
  return async (state) => {
    const prompt = await promptReady;
    const vars = gatherInput(params.input, state);
    const { system, user } = await prompt(vars);
    const fullSystem = [system, `Classify into exactly one of: ${params.labels.join(", ")}.`].filter(Boolean).join("\n\n");
    const result = await callLlm(ctx, { nodeId: ctx.node?.id, system: fullSystem, user, schema, model: params.model });
    if (result.structured === undefined) {
      throw new Error(`skills.classify: no parseable verdict (${result.parse_error ?? "no JSON found"})`);
    }
    const delta = { [params.out]: result.structured.label };
    if (params.out_detail) delta[params.out_detail] = result.structured;
    return delta;
  };
}
