/**
 * condition.switchOn — a router condition: read one channel, map its string
 * value through `cases` to a target token, else `default`.
 */

export const meta = {
  name: "condition.switchOn",
  category: "condition",
  summary: "Route on a channel value: cases map + default fallback.",
  params: {
    type: "object",
    required: ["on", "cases"],
    properties: {
      on: { type: "string", minLength: 1 },
      cases: { type: "object" },
      default: { type: "string" },
    },
  },
  returns: "condition",
};

/** @returns {(state: object) => string|undefined} */
export function switchOn(params) {
  return (state) => {
    const raw = state[params.on];
    const key = raw == null ? "" : String(raw);
    if (key in params.cases) return params.cases[key];
    return params.default;
  };
}
