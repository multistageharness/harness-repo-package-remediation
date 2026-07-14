/**
 * commands.renderReport — the guaranteed-artifact terminal leg: render a
 * template (file-based via template.handlebars, or config-declared via any
 * template.* pattern) against the full state and atomically write it under
 * an output dir. Composes template atoms THROUGH the registry — atoms
 * calling atoms via the same mapping the yaml uses.
 */

import { isAbsolute, join, resolve } from "node:path";

import { writeFileAtomic } from "../../services/atomic-fs.mjs";

export const meta = {
  name: "commands.renderReport",
  category: "commands",
  summary: "Render a template.* pattern against state → atomic artifact write → path into channel.",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      template: { type: "string" },
      template_uses: { type: "string" },
      template_with: { type: "object" },
      out_dir: { type: "string" },
      filename: { type: "string" },
      format: { enum: ["markdown", "json", "text"] },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

const EXT = { markdown: ".md", json: ".json", text: ".txt" };

export function renderReport(params, ctx) {
  const patternName = params.template_uses ?? "template.handlebars";
  const patternWith = params.template_uses ? params.template_with ?? {} : { path: params.template };
  return async (state) => {
    const { factory } = await ctx.registry.resolve(patternName);
    const render = factory(patternWith, ctx);
    const rendered = await render(state);

    const outDirRel = params.out_dir ?? "out";
    const outDir = isAbsolute(outDirRel) ? outDirRel : resolve(ctx.options.baseDir, outDirRel);
    const filename = params.filename ?? `${ctx.flow.name}-report${EXT[params.format ?? "markdown"]}`;
    const target = join(outDir, filename);

    if (ctx.options.dryRun) {
      ctx.emit("node.end", { note: `dry_run: skipped report write to ${target}` });
      return { [params.into]: { path: target, written: false, dry_run: true } };
    }
    await writeFileAtomic(target, rendered);
    return { [params.into]: { path: target, written: true, bytes: Buffer.byteLength(rendered) } };
  };
}
