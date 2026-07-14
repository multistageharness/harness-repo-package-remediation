---
name: pip-remediation
description: Remediate vulnerable Python/pip dependencies by bumping direct requirements or pinning transitive packages through a constraints file, keeping the environment reproducible.
---

# Python / pip remediation

For each vulnerable Python package:

- **Direct dependency** (in `requirements.txt` / `pyproject.toml`): pin the
  requirement to the exact patched version (`package==X.Y.Z`).
- **Transitive dependency**: add the patched version to a `constraints.txt` and
  install with `-c constraints.txt`, leaving the parent requirement untouched.
- Verify inside the repo's own virtualenv so the resolved closure reflects the
  repo, not the tooling environment.

Available tools: `pip-requirement-bump`, `pip-constraints-pin`. Prefer
`pip-requirement-bump` for direct findings and `pip-constraints-pin` for
transitive ones.
