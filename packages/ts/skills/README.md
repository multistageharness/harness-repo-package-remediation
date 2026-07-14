# harness-repo-package-remediation/skills — SKILL registry (industry SKILL.md spec)

A **central registry of Skills** (`langgraph-flow.md` capability 3) authored to
the industry [agentskills.io](https://agentskills.io) `SKILL.md` convention:
each skill is a directory `harness-repo-package-remediation/skills/<name>/SKILL.md` with YAML frontmatter
(`name`, `description`) followed by a markdown body of remediation guidance.

Skills are **loaded or referenced by the SDK** through the loader
`vendors/langgraph-harness-integration/src/skill-registry.mjs` (re-exported from
the SDK seam `src/sdk.mjs`):

- `loadSkillRegistry(dir?)` → `{ dir, skills[], byName, errors[] }`
- `getSkill(registry, name)` → the skill's frontmatter + resolved path
- `readSkillBody(registry, name)` → the markdown body (the reusable prompt text)

`skills.optimizePrompt` references a skill by name (chosen per repo ecosystem),
loads its body, and seeds the LLM system prompt with it — so a Skill authored
here becomes the reusable, reviewable instruction the SDK hands to the model.

The directory is resolved from an explicit argument, `$HARNESS_SKILLS_DIR`, or a
path relative to the loader module (`../../../skills` → this directory), so no
host-absolute path is ever baked in (user CLAUDE.md path convention).

## Frontmatter contract (enforced by the loader)

- `name` — required, kebab-case, must equal the containing directory name.
- `description` — required non-empty single line (used for relevance/selection).

Everything after the closing `---` is the skill body.
