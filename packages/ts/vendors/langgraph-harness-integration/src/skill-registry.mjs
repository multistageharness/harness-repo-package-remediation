/**
 * src/skill-registry.mjs — the SKILL registry loader (langgraph-flow.md
 * capability 3). Discovers every `<name>/SKILL.md` under a central skills
 * directory (`harness-repo-package-remediation/skills/` by default), parses the industry agentskills.io
 * frontmatter (`name`, `description`), validates it, and exposes the skills so
 * the SDK can LOAD or REFERENCE them — `skills.optimizePrompt` picks a skill by
 * name per repo ecosystem and seeds the LLM system prompt with its body.
 *
 * A skill is DATA (a reviewable markdown instruction), not an executable module,
 * so this loader only reads + parses files and stays outside the mapping trust
 * boundary — it may read the repo-root `harness-repo-package-remediation/skills/` directory that lives
 * OUTSIDE the pack.
 *
 * FRONTMATTER PARSING: no YAML dependency is resolvable from this pack (see
 * render-flow.mjs), and SKILL.md frontmatter is a flat `key: value` block, so it
 * is parsed by a tiny hand-rolled reader (the same discipline the pack uses for
 * its other no-dep parsers) rather than pulling in a YAML library.
 *
 * DIRECTORY RESOLUTION (user CLAUDE.md path convention): explicit `dir` argument,
 * then `$HARNESS_SKILLS_DIR`, then a path relative to THIS module
 * (`../../../skills` → repo-root `harness-repo-package-remediation/skills/`).
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The default skills dir: repo-root `harness-repo-package-remediation/skills/`, resolved off this module. */
export function defaultSkillsDir(env = process.env) {
  if (typeof env.HARNESS_SKILLS_DIR === "string" && env.HARNESS_SKILLS_DIR.length > 0) {
    return env.HARNESS_SKILLS_DIR;
  }
  // src/ → pack root → vendors → harness → skills
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills");
}

/**
 * Split a SKILL.md into `{ frontmatter, body }`. The frontmatter is the block
 * between the first two `---` fences at the top of the file; everything after the
 * closing fence is the body. A file with no leading fence has no frontmatter.
 * @returns {{frontmatter: Record<string,string>, body: string}}
 */
export function parseSkillMarkdown(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { frontmatter: {}, body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: normalized };
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, "");
  const frontmatter = {};
  for (const line of block.split("\n")) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

/**
 * Validate one skill's frontmatter against the agentskills.io contract.
 * @returns {string[]} human-readable problems (empty when valid)
 */
export function validateSkill(frontmatter, dirName, where = "skill") {
  const problems = [];
  const name = frontmatter.name;
  const description = frontmatter.description;
  if (typeof name !== "string" || name.length === 0) problems.push(`${where}: frontmatter 'name' is required`);
  else if (!NAME_RE.test(name)) problems.push(`${where}: name '${name}' must be kebab-case`);
  else if (name !== dirName) problems.push(`${where}: name '${name}' must equal its directory name '${dirName}'`);
  if (typeof description !== "string" || description.length === 0) problems.push(`${where}: frontmatter 'description' is required`);
  return problems;
}

/**
 * Load + validate every `<name>/SKILL.md` under the skills directory.
 * @param {string} [dir] override the skills directory (else env / module-relative)
 * @returns {{dir: string, skills: object[], byName: Map<string, object>, errors: {path: string, problems: string[]}[]}}
 */
export function loadSkillRegistry(dir = defaultSkillsDir()) {
  const skills = [];
  const errors = [];
  const byName = new Map();
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir).sort()) {
      if (entry.startsWith(".")) continue;
      const subdir = join(dir, entry);
      if (!statSync(subdir).isDirectory()) continue;
      const path = join(subdir, "SKILL.md");
      if (!existsSync(path)) continue;
      const { frontmatter, body } = parseSkillMarkdown(readFileSync(path, "utf8"));
      const problems = validateSkill(frontmatter, entry, path);
      if (frontmatter.name && byName.has(frontmatter.name)) problems.push(`duplicate skill name '${frontmatter.name}'`);
      if (problems.length > 0) {
        errors.push({ path, problems });
        continue;
      }
      const skill = { name: frontmatter.name, description: frontmatter.description, path, bodyLength: body.length, frontmatter };
      skills.push(skill);
      byName.set(skill.name, skill);
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { dir, skills, byName, errors };
}

/** Look up one skill by name, or null. */
export function getSkill(registry, name) {
  return registry.byName.get(name) ?? null;
}

/**
 * Read a skill's markdown body (the reusable prompt text the SDK seeds into the
 * model). Returns "" when the skill is unknown or its file has been removed.
 */
export function readSkillBody(registry, name) {
  const skill = getSkill(registry, name);
  if (!skill) return "";
  try {
    return parseSkillMarkdown(readFileSync(skill.path, "utf8")).body;
  } catch {
    return "";
  }
}
