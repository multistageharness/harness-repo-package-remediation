/**
 * template.interpolate — render an inline `{{var}}` template string against a
 * scope. The smallest template pattern; returns a render function.
 */

import { renderTemplate } from "../../template/engine.mjs";

export const meta = {
  name: "template.interpolate",
  category: "template",
  summary: "Render an inline {{var}} template string against a scope.",
  params: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string" },
    },
  },
  returns: "template",
};

/** @returns {(scope: object) => string} */
export function interpolate(params) {
  return (scope = {}) => renderTemplate(params.text, scope);
}
