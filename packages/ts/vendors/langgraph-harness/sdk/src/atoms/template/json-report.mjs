/**
 * template.jsonReport — deterministic JSON artifact builder: picks configured
 * channels out of the scope into a stable, sorted-key JSON document.
 */

export const meta = {
  name: "template.jsonReport",
  category: "template",
  summary: "Pick configured scope channels into a stable sorted-key JSON document.",
  params: {
    type: "object",
    required: ["pick"],
    properties: {
      pick: { type: "array", minItems: 1, items: { type: "string" } },
      envelope: { type: "object" },
    },
  },
  returns: "template",
};

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

/** @returns {(scope: object) => string} */
export function jsonReport(params) {
  return (scope = {}) => {
    const body = {};
    for (const key of params.pick) body[key] = scope[key];
    const doc = { ...(params.envelope ?? {}), ...body };
    return JSON.stringify(sortKeysDeep(doc), null, 2) + "\n";
  };
}
