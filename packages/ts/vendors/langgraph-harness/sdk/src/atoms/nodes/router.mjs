/**
 * nodes.router — evaluate ordered `rules` (safe-grammar `when` expressions)
 * and write the first matching token into `out` (default `<id>_route`).
 * A switch edge then reads that token. Conditional edges cannot mutate
 * state, so routing DECISIONS live in this node and routing WIRING in the
 * edge — the corpus idiom made declarative.
 */

import { compilePredicate } from "../../expr/expr.mjs";

export const meta = {
  name: "nodes.router",
  category: "nodes",
  summary: "Ordered when-rules → routing token channel (switch edges read it).",
  params: {
    type: "object",
    required: ["rules", "default"],
    properties: {
      rules: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["when", "token"],
          properties: {
            when: { type: "string", minLength: 1 },
            token: { type: "string", minLength: 1 },
          },
        },
      },
      default: { type: "string", minLength: 1 },
      out: { type: "string" },
    },
  },
  returns: "node",
};

export function router(params, ctx) {
  const compiled = params.rules.map((rule) => ({ predicate: compilePredicate(rule.when), token: rule.token, when: rule.when }));
  const outChannel = params.out ?? `${ctx.node?.id ?? "router"}_route`;
  return async (state) => {
    for (const rule of compiled) {
      if (rule.predicate(state)) {
        ctx.emit("edge.route", { node: ctx.node?.id, matched: rule.when, token: rule.token });
        return { [outChannel]: rule.token };
      }
    }
    ctx.emit("edge.route", { node: ctx.node?.id, matched: null, token: params.default });
    return { [outChannel]: params.default };
  };
}
