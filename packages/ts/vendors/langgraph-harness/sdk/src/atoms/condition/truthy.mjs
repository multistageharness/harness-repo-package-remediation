/**
 * condition.truthy — predicate on one channel's truthiness (non-empty
 * arrays/strings count as true; `negate` flips it).
 */

export const meta = {
  name: "condition.truthy",
  category: "condition",
  summary: "Predicate: is a channel truthy (non-empty array/string, true, non-zero)?",
  params: {
    type: "object",
    required: ["channel"],
    properties: {
      channel: { type: "string", minLength: 1 },
      negate: { type: "boolean" },
    },
  },
  returns: "condition",
};

/** @returns {(state: object) => boolean} */
export function truthy(params) {
  return (state) => {
    const value = state[params.channel];
    let result;
    if (Array.isArray(value)) result = value.length > 0;
    else if (typeof value === "string") result = value.length > 0;
    else result = !!value;
    return params.negate ? !result : result;
  };
}
