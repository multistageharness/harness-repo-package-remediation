/**
 * atoms/skills/_skill-base.mjs — shared plumbing for the LLM skill atoms
 * (private helper, not a mapped pattern).
 *
 * Every skill resolves its prompt THROUGH the registry (prompt.file for
 * `prompt: path.md`, prompt.system for inline strings, or any prompt.*
 * pattern via `prompt_uses`), gathers template vars from state via the
 * `input: {var: channel}` map, and calls the ONE llm seam with an optional
 * schema. Atoms composing atoms through the same mapping the yaml uses.
 */

/** Resolve the node's prompt params into a prompt function via the registry. */
export async function resolvePrompt(params, ctx) {
  if (params.prompt_uses) {
    const { factory } = await ctx.registry.resolve(params.prompt_uses);
    return factory(params.prompt_with ?? {}, ctx);
  }
  if (typeof params.prompt === "string") {
    const { factory } = await ctx.registry.resolve("prompt.file");
    return factory({ path: params.prompt }, ctx);
  }
  const { factory } = await ctx.registry.resolve("prompt.system");
  return factory({ system: params.system ?? "", user: params.user ?? "" }, ctx);
}

/** Gather `input: {templateVar: channelName}` values out of state. */
export function gatherInput(inputMap = {}, state) {
  const vars = {};
  for (const [varName, channel] of Object.entries(inputMap)) {
    const value = state[channel];
    vars[varName] = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  return vars;
}

/** Resolve a schema declaration: a `types` name, an inline object, or null. */
export function resolveSchema(declared, ctx) {
  if (declared == null) return null;
  if (typeof declared === "string") {
    const schema = ctx.flow.types?.[declared];
    if (!schema) throw new Error(`schema type '${declared}' is not declared in the flow's types block`);
    return schema;
  }
  return declared;
}

/** One llm call with events. */
export async function callLlm(ctx, { nodeId, system, user, schema, model, temperature }) {
  ctx.emit("llm.call", { node: nodeId, model: model ?? null, chars: system.length + user.length, structured: !!schema });
  const result = await ctx.llm.invoke({ system, user, schema, model, temperature });
  const payload = {
    node: nodeId,
    model: result.model ?? null,
    mode: result.mode,
    chars: result.content?.length ?? 0,
    parse_error: result.parse_error,
  };
  // Token accounting is optional on the seam (the mock and raw-fetch providers
  // may omit it); surface it when the provider reports it, so cost is visible on
  // the event stream and not only inside the provider.
  if (result.usage !== undefined) payload.usage = result.usage;
  ctx.emit("llm.result", payload);
  return result;
}
