/**
 * nodes.gate — validate one channel against a schema and write
 * `<channel>_ok` (or `ok_into`). The RETRY archetype's checkpoint: a loop
 * edge reads the flag via its `until` predicate and regenerates on failure.
 */

import { validateSchema } from "../../schema/mini-json-schema.mjs";
import { resolveSchema } from "../skills/_skill-base.mjs";

export const meta = {
  name: "nodes.gate",
  category: "nodes",
  summary: "Schema-validate a channel → boolean <channel>_ok flag (+ issue diagnostics).",
  params: {
    type: "object",
    required: ["channel", "schema"],
    properties: {
      channel: { type: "string", minLength: 1 },
      schema: true,
      ok_into: { type: "string" },
    },
  },
  returns: "node",
};

export function gate(params, ctx) {
  const okChannel = params.ok_into ?? `${params.channel}_ok`;
  return async (state) => {
    const schema = resolveSchema(params.schema, ctx);
    const issues = validateSchema(state[params.channel], schema, params.channel);
    const ok = issues.length === 0;
    const delta = { [okChannel]: ok };
    if (!ok) {
      delta.error_logs = [
        `[${ctx.node?.id}] gate failed on '${params.channel}': ${issues
          .slice(0, 3)
          .map((i) => `${i.path}: ${i.message}`)
          .join("; ")}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}`,
      ];
    }
    return delta;
  };
}
