/**
 * commands.fsWrite — atomically write a channel's content to a file
 * (write-temp → fsync → rename). Honors dry_run: logs and skips the write,
 * so wiring can be validated against real inputs with zero side effects.
 */

import { isAbsolute, resolve } from "node:path";

import { writeFileAtomic } from "../../services/atomic-fs.mjs";

export const meta = {
  name: "commands.fsWrite",
  category: "commands",
  summary: "Atomic file write of a channel's content; dry_run logs-and-skips.",
  params: {
    type: "object",
    required: ["path", "into"],
    properties: {
      path: { type: "string", minLength: 1 },
      content_from: { type: "string" },
      content: { type: "string" },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function fsWrite(params, ctx) {
  return async (state) => {
    const abs = isAbsolute(params.path) ? params.path : resolve(ctx.options.baseDir, params.path);
    const raw = params.content_from ? state[params.content_from] : params.content ?? "";
    const content = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
    if (ctx.options.dryRun) {
      ctx.emit("node.end", { note: `dry_run: skipped write to ${params.path}` });
      return { [params.into]: { path: abs, written: false, dry_run: true } };
    }
    await writeFileAtomic(abs, content);
    return { [params.into]: { path: abs, written: true, bytes: Buffer.byteLength(content) } };
  };
}
