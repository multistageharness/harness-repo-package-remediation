/**
 * template.handlebars — load a `.hbs`/`.md` template FILE and render it with
 * the closed template engine ({{var}}, {{json v}}, {{#if}}, {{#each}}).
 *
 * The report-template pattern: `commands.renderReport` delegates here.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { renderTemplate } from "../../template/engine.mjs";
import { ConfigLoadError } from "../../errors.mjs";

export const meta = {
  name: "template.handlebars",
  category: "template",
  summary: "Load a .hbs/.md template file; render {{var}} / {{#if}} / {{#each}} sections.",
  params: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string", minLength: 1 },
    },
  },
  returns: "template",
};

/** @returns {(scope: object) => Promise<string>} */
export function handlebars(params, ctx) {
  const abs = isAbsolute(params.path) ? params.path : resolve(ctx.options.baseDir, params.path);
  let cached = null;
  return async (scope = {}) => {
    if (cached == null) {
      try {
        cached = await readFile(abs, "utf8");
      } catch (err) {
        throw new ConfigLoadError(`cannot read template '${params.path}': ${err.message}`, { path: abs });
      }
    }
    return renderTemplate(cached, scope);
  };
}
