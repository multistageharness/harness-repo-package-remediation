/**
 * prompt.system — inline system+user prompt strings with `{{var}}` binding.
 *
 * The corpus-dominant pattern (a module-level SYSTEM_PROMPT constant +
 * assembled user turn), expressed declaratively.
 */

import { renderTemplate } from "../../template/engine.mjs";

export const meta = {
  name: "prompt.system",
  category: "prompt",
  summary: "Inline system + user prompt strings with {{var}} binding.",
  params: {
    type: "object",
    properties: {
      system: { type: "string" },
      user: { type: "string" },
    },
  },
  returns: "prompt",
};

/**
 * @returns {(vars: object) => Promise<{system: string, user: string}>}
 */
export function system(params) {
  return async (vars = {}) => ({
    system: renderTemplate(params.system ?? "", vars),
    user: renderTemplate(params.user ?? "", vars),
  });
}
