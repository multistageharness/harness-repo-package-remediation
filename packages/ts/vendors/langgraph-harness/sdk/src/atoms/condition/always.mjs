/**
 * condition.always — the constant predicate. Exists so tests and custom
 * edges can pin a branch deterministically.
 */

export const meta = {
  name: "condition.always",
  category: "condition",
  summary: "Constant predicate (true unless value: false).",
  params: {
    type: "object",
    properties: {
      value: { type: "boolean" },
    },
  },
  returns: "condition",
};

/** @returns {(state: object) => boolean} */
export function always(params = {}) {
  const result = params.value ?? true;
  return () => result;
}
