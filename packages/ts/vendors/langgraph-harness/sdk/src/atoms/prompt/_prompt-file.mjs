/**
 * atoms/prompt/_prompt-file.mjs — shared parser for `.md` prompt files
 * (underscore prefix = private helper, not a mapped pattern).
 *
 * Format (the corpus/reference convention):
 *
 *   ---
 *   description: what this prompt does
 *   vars: [question, context]        # allowlisted template vars
 *   ---
 *   # system
 *   You are ...
 *   # user
 *   Question: {{question}}
 *
 * Binding uses the closed template engine; referencing a var that is not in
 * the allowlist is an authoring error surfaced at load time.
 */

import { readFile } from "node:fs/promises";

import { extractTemplateVars } from "../../template/engine.mjs";
import { ConfigLoadError } from "../../errors.mjs";

export function parsePromptText(text, sourcePath = "<memory>") {
  let frontMatter = {};
  let body = text;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (fm) {
    body = text.slice(fm[0].length);
    // minimal front-matter: `key: value` and `key: [a, b]` lines only
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      const [, key, rawValue] = m;
      const listMatch = /^\[(.*)\]$/.exec(rawValue.trim());
      frontMatter[key] = listMatch
        ? listMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : rawValue.trim();
    }
  }

  const sections = { system: "", user: "" };
  let current = "user";
  const lines = body.split(/\r?\n/);
  const buffers = { system: [], user: [] };
  for (const line of lines) {
    const heading = /^#\s+(system|user)\s*$/i.exec(line.trim());
    if (heading) {
      current = heading[1].toLowerCase();
      continue;
    }
    buffers[current].push(line);
  }
  sections.system = buffers.system.join("\n").trim();
  sections.user = buffers.user.join("\n").trim();
  if (!sections.system && !sections.user) {
    throw new ConfigLoadError(`prompt file '${sourcePath}' has no '# system' or '# user' content`, { path: sourcePath });
  }

  const declaredVars = Array.isArray(frontMatter.vars) ? frontMatter.vars : [];
  const usedVars = [...new Set([...extractTemplateVars(sections.system), ...extractTemplateVars(sections.user)])];
  const undeclared = usedVars.filter((v) => !declaredVars.includes(v));
  if (declaredVars.length > 0 && undeclared.length > 0) {
    throw new ConfigLoadError(
      `prompt file '${sourcePath}' uses vars not in its front-matter allowlist: ${undeclared.join(", ")}`,
      { path: sourcePath, undeclared },
    );
  }

  return { frontMatter, system: sections.system, user: sections.user, vars: declaredVars.length ? declaredVars : usedVars };
}

export async function loadPromptFile(absPath) {
  let text;
  try {
    text = await readFile(absPath, "utf8");
  } catch (err) {
    throw new ConfigLoadError(`cannot read prompt file '${absPath}': ${err.message}`, { path: absPath });
  }
  return parsePromptText(text, absPath);
}
