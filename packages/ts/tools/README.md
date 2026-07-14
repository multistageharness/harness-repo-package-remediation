# harness-repo-package-remediation/tools — central remediation tool registry

A **central place** (`langgraph-flow.md` capability 2) that declares the
language-specific remediation tools the pipeline can hand to the SDK/LLM when it
builds an optimized remediation prompt (capability 4) and executes a plan
(capability 5).

Each tool is a small JSON manifest `<ecosystem>/<id>.tool.json`. The loader
(`vendors/langgraph-harness-integration/src/tool-registry.mjs`, re-exported from
the SDK seam `src/sdk.mjs`) discovers every `*.tool.json` under this directory,
validates it, and exposes:

- `loadToolRegistry(dir?)` → `{ dir, tools[], byEcosystem, errors[] }`
- `toolsForEcosystem(registry, group)` → the tools tagged for one ecosystem
  group (`node` | `python` | `java` | `golang` | `rust` | `docker` | `other`)

The directory is resolved, in order, from an explicit argument, the
`HARNESS_TOOLS_DIR` env var, or a path relative to the loader module (so no
host-absolute path is ever baked in — user CLAUDE.md path convention).

## Manifest shape

```json
{
  "id": "npm-version-bump",
  "ecosystem": "node",
  "kind": "remediation",
  "title": "npm dependency version bump",
  "description": "Bump a declared npm dependency to a fixed version in package.json.",
  "capabilities": ["direct-bump", "manifest-edit"],
  "manifests": ["package.json"],
  "argv_template": ["npm", "install", "{{package}}@{{version}}", "--save-exact"],
  "produces": ["package.json", "package-lock.json"],
  "safety": "formatting-preserving in-place edit; lockfile regen deferred"
}
```

### Contract (enforced by the loader)

- `id`, `ecosystem`, `kind`, `title`, `description` are required non-empty strings.
- `ecosystem` must be one of the known ecosystem groups.
- `packageManager`, when present, must be one of the known package managers
  (`npm` | `pnpm` | `pip` | `poetry` | `uv` | `conda` | `maven` | `cargo` |
  `docker` — `TOOL_PACKAGE_MANAGERS`). It is an **orthogonal, optional
  dimension** finer than the ecosystem group (change record 0033/A1): npm and
  pnpm are both `node`; pip/poetry/uv/conda are all `python`. Tools that omit
  it validate exactly as before.
- `argv_template`, when present, is a non-empty list of literal string tokens.
  **No token may contain a shell metacharacter** (`& | ; < > \` newline`) —
  argv lists never reach a shell (security rule §4). Placeholders are
  whole-token (`{{package}}`, `{{version}}`, `{{from}}`, `{{module.dir}}`).
- `capabilities`, `manifests`, `produces` are optional string lists.

Tools are **declarative data**, not executable code: the harness surfaces them
to the LLM and records which tool a remediation used; the actual in-place bump is
performed by `commands.repoRemediate` through `src/ecosystem-registry.mjs`.

## Version-discovery manifests (`kind: "version-discovery"`)

Change record 0033/D0–D9: one finder per package manager
(`<group>/<pm>-find-next-version.tool.json`), each declaring `packageManager`
plus the literal `argv_template` its install-test runs. The executable half is
the shared engine `src/version-discovery.mjs` (verbs `versions` / `find` /
`test`, adapter-per-package-manager), surfaced as the `commands.findNextVersion`
atom, the SDK re-exports on `src/sdk.mjs`, and the `flow find-version` CLI verb.
`kind` is free-form to the loader, so these manifests need no loader change
beyond the optional `packageManager` validation:

```json
{
  "id": "npm-find-next-version",
  "ecosystem": "node",
  "packageManager": "npm",
  "kind": "version-discovery",
  "title": "npm next-available version finder",
  "description": "…",
  "capabilities": ["versions", "find", "test"],
  "argv_template": ["npm", "install", "{{package}}@{{version}}", "--no-save", "--no-audit", "--no-fund"],
  "produces": ["installation_report.json"],
  "safety": "install-test runs in an isolated scratch dir, never the target repo"
}
```
