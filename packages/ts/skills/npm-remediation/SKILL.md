---
name: npm-remediation
description: Remediate vulnerable npm/Node.js dependencies by bumping direct versions in package.json or pinning transitive packages via an overrides block, preserving formatting and existing lockfile discipline.
---

# npm / Node.js remediation

For each vulnerable npm package:

- **Direct dependency** (declared in `dependencies` / `devDependencies`): bump
  its version string to the patched version in place, preserving formatting.
- **Transitive dependency**: add or extend the `overrides` block in
  `package.json` to force the patched version, leaving the parent dependency at
  its current version.
- After editing, the resolved tree must satisfy the advisory's
  `first_patched_version`. Do not run `npm audit fix --force` — it may introduce
  breaking major bumps.

Available tools: `npm-version-bump`, `npm-overrides-pin`, `npm-audit-fix`.
Prefer `npm-version-bump` for direct findings and `npm-overrides-pin` for
transitive ones.
