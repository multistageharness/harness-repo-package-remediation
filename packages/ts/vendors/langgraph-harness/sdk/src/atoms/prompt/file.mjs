/**
 * prompt.file — load a `.md` prompt file (front-matter + `# system`/`# user`
 * sections) and bind `{{var}}` template variables.
 *
 * The default prompt pattern: skills atoms delegate here whenever a node
 * declares `with.prompt: prompts/x.md`.
 */

import { isAbsolute, resolve } from "node:path";

import { loadPromptFile } from "./_prompt-file.mjs";
import { renderTemplate } from "../../template/engine.mjs";

export const meta = {
  name: "prompt.file",
  category: "prompt",
  summary: "Load a .md prompt file (front-matter + # system/# user) and bind {{vars}}.",
  params: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string", minLength: 1 },
    },
  },
  returns: "prompt",
};

/**
 * @returns {(vars: object) => Promise<{system: string, user: string}>}
 */
export function file(params, ctx) {
  const abs = isAbsolute(params.path) ? params.path : resolve(ctx.options.baseDir, params.path);
  let cached = null;
  return async (vars = {}) => {
    cached ??= await loadPromptFile(abs);
    return {
      system: renderTemplate(cached.system, vars),
      user: renderTemplate(cached.user, vars),
    };
  };
}
