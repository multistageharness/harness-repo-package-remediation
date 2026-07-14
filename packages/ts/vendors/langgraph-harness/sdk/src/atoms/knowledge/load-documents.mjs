/**
 * knowledge.loadDocuments — read a directory of text documents (.md/.txt by
 * default) into a channel as [{id, path, text}]. The ingestion mouth of the
 * RAG lane; deterministic local I/O (runs for real under mock).
 */

import { readFile, readdir } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

export const meta = {
  name: "knowledge.loadDocuments",
  category: "knowledge",
  summary: "Read a directory of .md/.txt documents into [{id, path, text}].",
  params: {
    type: "object",
    required: ["source", "into"],
    properties: {
      source: { type: "string", minLength: 1 },
      extensions: { type: "array", items: { type: "string" } },
      into: { type: "string", minLength: 1 },
      max: { type: "integer", minimum: 1, maximum: 10000 },
    },
  },
  returns: "node",
};

async function walk(root, current, exts, out, max) {
  if (out.length >= max) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (err) {
    throw new Error(`knowledge.loadDocuments: cannot read dir '${current}': ${err.message}`);
  }
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= max) return;
    const full = join(current, ent.name);
    if (ent.isDirectory() && !ent.name.startsWith(".") && ent.name !== "node_modules") {
      await walk(root, full, exts, out, max);
    } else if (ent.isFile() && exts.includes(extname(ent.name))) {
      const text = await readFile(full, "utf8");
      const rel = relative(root, full).replaceAll("\\", "/");
      out.push({ id: rel, path: rel, text });
    }
  }
}

export function loadDocuments(params, ctx) {
  return async () => {
    const root = isAbsolute(params.source) ? params.source : resolve(ctx.options.baseDir, params.source);
    const exts = params.extensions ?? [".md", ".txt"];
    const docs = [];
    await walk(root, root, exts, docs, params.max ?? 1000);
    return { [params.into]: docs };
  };
}
