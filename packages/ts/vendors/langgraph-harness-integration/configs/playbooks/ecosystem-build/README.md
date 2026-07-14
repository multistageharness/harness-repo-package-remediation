# Ecosystem build playbooks (change record 0029/D1)

The step-13 `build` counterpart of [`../ecosystem-installation/`](../ecosystem-installation/README.md)
(0026/D2) — one directory per **`ECOSYSTEM_GROUPS` key** (`src/ecosystem-registry.mjs`), the
same closed enum the depgraph router and the install selector branch on, so the build selector
introduces **no new taxonomy**. The finer signal-matrix ids are `toolchains:` **within** a
playbook, keyed by `detectToolchain()`; the `default:` key covers a fingerprint whose
toolchain signals are absent.

```
ecosystem-build/
├── node/    build.yaml    # npm run build --if-present  (guard: npm)
├── java/    build.yaml    # mvn -B package -DskipTests | ./gradlew build -x test
├── python/  build.yaml    # python -m build | poetry build | uv build
├── golang/  build.yaml    # go build ./...
├── docker/  build.yaml    # no-op: `toolchains: {}`, stated reason (no build lane)
└── other/   build.yaml    # no-op, same shape
```

## Authoring contract

Identical to the install playbooks' contract (enforced at load by
`commands.buildRun › loadPlaybook` — see
[`../ecosystem-installation/README.md`](../ecosystem-installation/README.md) §1–6): the
`ecosystem:` key must equal the directory name, `argv` is a list of literal tokens
(security rule §4 — no shell metacharacters), only the `{{module.dir}}` /
`{{module.manifest}}` whole-token placeholders are substituted, every step carries
`tool` / `guard` / `artifact` / `allowNonZero: true` (a build failure is a RECORDED
outcome, never a throw — 0025/A1), credentials are env-only, and `docker`/`other` are
explicit no-ops with a stated `reason:`.

Build-specific notes:

- **Builds assume the step-10 install ran** — `npm run build` without `node_modules/`,
  or `go build` without a filled module cache, exits non-zero and is recorded honestly.
  The flow orders `install → install_verify → … → build` for exactly this reason.
- **A repo with no build step is a legitimate outcome**: node uses
  `npm run build --if-present` (exit 0 when no `build` script), and python's
  `python -m build` over a repo without packaging metadata records its non-zero exit —
  degrade, never guess.
- **Testing is not this stage's job**: java skips tests (`-DskipTests` / `-x test`);
  a future `test` stage (and its `test`-namespaced snapshot) is its own change record.

## The authority boundary (0026/A3, reaffirmed by 0029/D1)

Any LLM-detected `integrated[].build`-style evidence — shell strings detected over
untrusted repo excerpts — is **evidence, never an execution plan**. `commands.buildRun`
never executes it; execution comes exclusively from these repo-authored, reviewed,
argv-list playbooks, selected by the fingerprint-derived `modules[].ecosystem`. A
divergence between the LLM's evidence and the executed argv is recorded as an
informational finding on the build result.
