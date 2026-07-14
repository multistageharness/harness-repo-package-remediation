/**
 * condition.expression — compile a `when`/`until` string from the CLOSED
 * expression grammar into a boolean predicate over state.
 *
 * The only sanctioned way config text becomes executable logic; `require`,
 * `process.env`, indexing and calls are unrepresentable in the grammar.
 */

import { compilePredicate } from "../../expr/expr.mjs";

export const meta = {
  name: "condition.expression",
  category: "condition",
  summary: "Safe closed-grammar predicate over state (==, !=, <, >, &&, ||, !, in, state.x.y).",
  params: {
    type: "object",
    required: ["expr"],
    properties: {
      expr: { type: "string", minLength: 1 },
    },
  },
  returns: "condition",
};

/** @returns {(state: object) => boolean} */
export function expression(params) {
  return compilePredicate(params.expr);
}
