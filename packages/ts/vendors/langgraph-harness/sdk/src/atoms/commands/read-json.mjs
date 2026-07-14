/**
 * commands.readJson — read + parse a JSON or YAML data file into a channel
 * (the queue-seed pattern: repos.yaml, tickets.json, ...). An optional
 * `pick` drills into a top-level key.
 */

import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import YAML from "yaml";

export const meta = {
  name: "commands.readJson",
  category: "commands",
  summary: "Parse a JSON/YAML data file into a channel (queue seeds, fixtures).",
  params: {
    type: "object",
    required: ["path", "into"],
    properties: {
      path: { type: "string", minLength: 1 },
      pick: { type: "string" },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function readJson(params, ctx) {
  return async () => {
    const abs = isAbsolute(params.path) ? params.path : resolve(ctx.options.baseDir, params.path);
    let text;
    try {
      text = await readFile(abs, "utf8");
    } catch (err) {
      throw new Error(`commands.readJson: cannot read '${params.path}': ${err.message}`);
    }
    let doc;
    try {
      doc = [".yaml", ".yml"].includes(extname(abs)) ? YAML.parse(text) : JSON.parse(text);
    } catch (err) {
      throw new Error(`commands.readJson: parse error in '${params.path}': ${err.message}`);
    }
    const value = params.pick ? doc?.[params.pick] : doc;
    return { [params.into]: value };
  };
}
