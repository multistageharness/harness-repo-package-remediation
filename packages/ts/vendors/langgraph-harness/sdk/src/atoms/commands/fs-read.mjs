/**
 * commands.fsRead — read a text file into a channel. Local reads are
 * deterministic, so they run for real even under mock (matching the corpus:
 * only network/git/subprocess I/O is stubbed offline).
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export const meta = {
  name: "commands.fsRead",
  category: "commands",
  summary: "Read a text file into a channel (relative paths resolve against the flow dir).",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      path: { type: "string" },
      path_from: { type: "string" },
      into: { type: "string", minLength: 1 },
      optional: { type: "boolean" },
    },
  },
  returns: "node",
};

export function fsRead(params, ctx) {
  return async (state) => {
    const rel = params.path_from ? state[params.path_from] : params.path;
    if (typeof rel !== "string" || rel.length === 0) {
      throw new Error(`commands.fsRead: no path (path param or path_from channel '${params.path_from ?? ""}')`);
    }
    const abs = isAbsolute(rel) ? rel : resolve(ctx.options.baseDir, rel);
    try {
      const text = await readFile(abs, "utf8");
      return { [params.into]: text };
    } catch (err) {
      if (params.optional) return { [params.into]: "", error_logs: [`[fsRead] optional read failed: ${rel}`] };
      throw new Error(`commands.fsRead: cannot read '${rel}': ${err.message}`);
    }
  };
}
