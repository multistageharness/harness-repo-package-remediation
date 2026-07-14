# Ecosystem installation playbooks (change record 0026/D2)

One directory per **`ECOSYSTEM_GROUPS` key** (`src/ecosystem-registry.mjs`) — the same closed
enum the step-11 depgraph router branches on, so the playbook selector introduces **no new
taxonomy**. The finer signal-matrix ids (`java-maven` vs `java-gradle`, `pip`/`poetry`/`uv`)
are `toolchains:` **within** a playbook, keyed by `detectToolchain()`; the `default:` key
covers a fingerprint whose toolchain signals are absent.

```
ecosystem-installation/
├── node/    install.yaml    # npm ci (requires_file: package-lock.json) → fallback npm install  (guard: npm)
├── java/    install.yaml    # mvn -B install -DskipTests | ./gradlew build -x test
├── python/  install.yaml    # python3 -m venv .venv → .venv/bin/pip install …  (0026/A4)
├── golang/  install.yaml    # go mod download
├── docker/  install.yaml    # no-op: `toolchains: {}`, stated reason (no install lane)
└── other/   install.yaml    # no-op, same shape
```

## Authoring contract (enforced at load by `commands.installRun › loadPlaybook`)

1. **`ecosystem:` must equal the directory name** — validated at load.
2. **`argv` is a LIST OF LITERAL TOKENS** (security rule §4). No `&&`, `|`, `;`, `>`, `<`,
   backticks, no shell, no interpolation of any value that originated in repo content or an
   LLM reply. Each step runs with `cwd` set to the install location's directory inside the
   clone, so paths in tokens are location-relative.
3. The **only** values the atom substitutes are the whole-token placeholders
   `{{module.dir}}` / `{{module.manifest}}` — fingerprint-derived, repo-relative paths —
   each landing as a **single** argv token (never spliced into a larger string).
4. Every step carries `tool`, `guard` (the CLI probed on PATH — absent → recorded skip,
   never a failure), `artifact` (raw-stdout filename under the per-repo save dir), and
   `allowNonZero: true` — the atom must not throw; a non-zero exit is a RECORDED outcome
   (0025/A1). An optional `requires_file:` (a location-relative path, no `..` escapes)
   gates the step up front: when the file is absent the step is bypassed as a recorded
   skip instead of attempted — `npm ci` only ever runs against an existing
   `package-lock.json`; a lockfile-less location goes straight to `npm install`. An
   optional `fallback:` step (same shape, same gates) runs when the primary's guard or
   `requires_file` gate fails, or the primary exits non-zero at runtime (lockfile drift —
   degrade, don't guess).
5. **No credentials, ever** (security rule §5). A playbook that needs a private registry
   token reads it from env **at the seam**; it appears in no yaml, channel, event, log, or
   artifact.
6. `docker`/`other` are **explicit no-ops with a stated `reason:`** — "no playbook" and "a
   playbook that installs nothing" are different results.

## The authority boundary (0026/A3)

`integrated[].install` — the LLM's shell strings detected over untrusted repo excerpts — is
**evidence, never an execution plan**. `commands.installRun` never executes it; execution
comes exclusively from these repo-authored, reviewed, argv-list playbooks, selected by the
fingerprint-derived `modules[].ecosystem`. A divergence between the LLM's evidence and the
playbook's argv is recorded as an informational finding on the install result. Do not
"simplify" the atom by piping `integrated[].install` into a shell.

## The fallback rule (0026/D4)

Installation resolution is a two-tier lookup: **tier 1 — a repo-specific installation
definition — is OUT OF SCOPE (deferred, not implemented)**; tier 2 is these ecosystem
playbooks. Every location today falls through to its ecosystem playbook; when tier 1 lands
it slots in **above** the playbook (override, not merge), must be a repo-authored argv-list
definition validated against this same schema, and may **never** be `integrated[].install`.
