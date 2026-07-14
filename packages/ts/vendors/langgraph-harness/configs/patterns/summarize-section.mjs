/**
 * skills.summarizeSection — CUSTOM pattern: summarize ONE fanout branch item
 * and join it into a merge-reducer channel keyed by the branch index
 * (`{sections_summaries: {"s0": "..."}}`). Send branches share one
 * superstep, so keyed-merge writes are the deterministic join contract.
 * Composes the SDK's llm seam — custom patterns get the same ctx atoms do.
 */

export const meta = {
  name: "skills.summarizeSection",
  category: "skills",
  summary: "Summarize one fanout item; join keyed-by-index into a merge channel.",
  params: {
    type: "object",
    required: ["item_from", "index_from", "into"],
    properties: {
      model: { type: "string" },
      item_from: { type: "string", minLength: 1 },
      index_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      max_words: { type: "integer", minimum: 5, maximum: 500 },
    },
  },
  returns: "node",
};

export function summarizeSection(params, ctx) {
  return async (state) => {
    const item = state[params.item_from];
    const index = state[params.index_from];
    const material = typeof item === "string" ? item : JSON.stringify(item);
    ctx.emit("llm.call", { node: ctx.node?.id, branch: index, chars: material.length, structured: false });
    const result = await ctx.llm.invoke({
      system: `Summarize the section in at most ${params.max_words ?? 60} words.`,
      user: material,
      model: params.model,
    });
    ctx.emit("llm.result", { node: ctx.node?.id, branch: index, mode: result.mode, chars: result.content.length });
    return { [params.into]: { [`s${index}`]: result.content } };
  };
}
