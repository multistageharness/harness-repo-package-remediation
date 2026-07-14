/**
 * skills.extract — text → an array of structured items. Items are
 * individually re-validated against `item_schema`; invalid ones are DROPPED
 * (drop-invalid contract) with a diagnostics entry, never silently kept.
 */

import { validateSchema } from "../../schema/mini-json-schema.mjs";
import { callLlm, gatherInput, resolvePrompt, resolveSchema } from "./_skill-base.mjs";

export const meta = {
  name: "skills.extract",
  category: "skills",
  summary: "LLM extraction: text → T[] items, each re-validated (drop-invalid).",
  params: {
    type: "object",
    required: ["item_schema", "out"],
    properties: {
      model: { type: "string" },
      prompt: { type: "string" },
      prompt_uses: { type: "string" },
      prompt_with: { type: "object" },
      system: { type: "string" },
      user: { type: "string" },
      input: { type: "object" },
      item_schema: true,
      max_items: { type: "integer", minimum: 1, maximum: 1000 },
      out: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function extract(params, ctx) {
  const promptReady = resolvePrompt(params, ctx);
  return async (state) => {
    const itemSchema = resolveSchema(params.item_schema, ctx);
    const schema = {
      type: "object",
      required: ["items"],
      properties: { items: { type: "array", items: itemSchema, minItems: 1 } },
    };
    const prompt = await promptReady;
    const vars = gatherInput(params.input, state);
    const { system, user } = await prompt(vars);
    const result = await callLlm(ctx, { nodeId: ctx.node?.id, system, user, schema, model: params.model });
    if (result.structured === undefined) {
      throw new Error(`skills.extract: no parseable items (${result.parse_error ?? "no JSON found"})`);
    }
    const items = Array.isArray(result.structured.items) ? result.structured.items : [];
    const kept = [];
    let dropped = 0;
    for (const item of items.slice(0, params.max_items ?? 100)) {
      if (validateSchema(item, itemSchema).length === 0) kept.push(item);
      else dropped++;
    }
    const delta = { [params.out]: kept };
    if (dropped > 0) delta.error_logs = [`[${ctx.node?.id}] skills.extract dropped ${dropped} invalid item(s)`];
    return delta;
  };
}
