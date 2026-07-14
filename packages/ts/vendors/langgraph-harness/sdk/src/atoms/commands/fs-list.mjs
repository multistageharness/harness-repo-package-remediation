/**
 * commands.fsList — recursively list files under a directory into a channel
 * (sorted, relative, forward-slash paths). Optional `*.ext` suffix filter.
 * Deterministic local I/O — runs for real under mock.
 */

import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const meta = {
  name: "commands.fsList",
  category: "commands",
  summary: "Recursive sorted file listing of a directory into a channel.",
  params: {
    type: "object",
    required: ["dir", "into"],
    properties: {
      dir: { type: "string", minLength: 1 },
      ext: { type: "string" },
      into: { type: "string", minLength: 1 },
      max: { type: "integer", minimum: 1, maximum: 100000 },
    },
  },
  returns: "node",
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".runs", "__pycache__", ".venv"]);

async function walk(root, current, out, max) {
  if (out.length >= max) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= max) return;
    const full = join(current, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) await walk(root, full, out, max);
    } else if (ent.isFile()) {
      out.push(relative(root, full).replaceAll("\\", "/"));
    }
  }
}

export function fsList(params, ctx) {
  return async () => {
    const root = isAbsolute(params.dir) ? params.dir : resolve(ctx.options.baseDir, params.dir);
    const files = [];
    await walk(root, root, files, params.max ?? 10000);
    const filtered = params.ext ? files.filter((f) => f.endsWith(params.ext)) : files;
    return { [params.into]: filtered };
  };
}
