# Vendored dependencies

Third-party / internal code vendored into this repo as a **pristine mirror** via `git subtree`.
Nothing here is edited in place — integration code that builds *on top of* a vendored package
lives in a **sibling** directory (e.g. `langgraph-harness-integration/`), never inside the mirror.

## `langgraph-harness/`

**What it is:** the enterprise config-driven LangChain + LangGraph platform (upstream package name
`v100`) — atomic pattern
files (prompt / template / skills / commands / knowledge / nodes / edges / condition / checkpoints)
wired by a `yaml → mapping → registry → execute` pipeline, shipped as `sdk` + `backend` + `cli` +
`frontend`.

**Source repo:** `git@github.com:multistageharness-com/INTERNAL_use-cases-harness-langgraph.git`
(private; clone with the `id_ed25519_multistageharness` deploy key).

**Vendored subdir:** `v100/` of that repo (≈760K of a 25M source tree) — the other top-level dirs
(`projects/`, `backlog/`, `public/` submodule, …) are intentionally **not** vendored.

**Pinned upstream SHA:** `9caf8c58724738648603b0507d5d3acca9182c74` ("stage", 2026-07-06).
Recorded in the squash/merge commit that introduced `harness-repo-package-remediation/vendors/langgraph-harness/` (see
`git log -- harness-repo-package-remediation/vendors/langgraph-harness`) and echoed by the `git-subtree-split` trailer on the squashed
content commit.

**Why the dir is named `langgraph-harness`:** a descriptive local name for this vendored
LangChain + LangGraph platform. Upstream it calls itself `v100` (`"name": "v100"` in its
`package.json`). A bare `v100/` was rejected as opaque for a vendored dir;
`use-cases-harness-langgraph` was rejected as leaking the whole source-repo name for a single
subdir.

**npm identity — locally renamed from `@v100/*`.** The mirror's npm package identities were
renamed away from upstream's `v100` / `@v100/*` to the `@internal/langgraph-langchain-harness`
family: the root package is `@internal/langgraph-langchain-harness` and the four workspaces are
`@internal/langgraph-langchain-harness-{sdk,cli,backend,frontend}`. The mapping-loader's allowed
bare-specifier prefix moved in lockstep, so `mapping.default.yaml` / `configs/mapping.yaml` atom
specifiers now read `@internal/langgraph-langchain-harness-sdk/atoms/…`. The remaining platform
identifiers were renamed in lockstep as well: the CLI **bin** name (`v100` → `langgraph-langchain-harness`),
the env namespace (`V100_*` → `LANGGRAPH_LANGCHAIN_HARNESS_*`), and the error-class prefix
(`V100Error` → `LanggraphLangchainHarnessError`). **No `v100`/`V100` platform identifier survives
inside the mirror** — the only retained `v100` mentions are references to the out-of-tree
`.claude/rules/v100-security-rules.md` convention and the `vendor-v100-and-extend` plan slug, which
keep their own names. **Consequence:** the mirror is no longer a byte-for-byte fast-forward of
upstream, so the `git subtree pull` recipe below will conflict on the renamed identity lines;
re-apply the rename after each refresh.

**Pristine-mirror rule:** treat `vendors/langgraph-harness/` as read-only upstream. Do **not** add integration
atoms, config packs, flows, or tests inside it — that belongs in the sibling `langgraph-harness-integration/`
so `git subtree pull` stays a clean fast-forward. The only expected untracked paths inside the
mirror are its own gitignored build/install outputs (`node_modules/`, `frontend/dist/`, coverage).

### Verifying the mirror in place

The mirror passes its own offline gate (91 tests: sdk 57 · backend 13 · cli 10 · frontend 11, plus
the 9-example sweep and docs regeneration). The frontend's `pretest` builds `dist/` via a lifecycle
hook, so if your environment sets `ignore-scripts=true` (a common security default), enable scripts
for the verify run only:

```sh
cd langgraph-harness
npm install
npm_config_ignore_scripts=false npm run verify   # green: no network, no API key, no git
```

`node_modules/` and `frontend/dist/` stay gitignored — never commit them into the mirror.

## `repository-fingerprint/`

**What it is:** the polyglot **Repository Fingerprint** tool (upstream package family
`@repo-fingerprint/*`) — detects a repository's ecosystems, package managers / build tools,
topology (monorepo/workspace), frameworks, testing tools and infrastructure signals against a shared
JSON **Detection Report** contract (`schema/detection-report.schema.json`). Ships four twin
implementations (bash, PowerShell, TypeScript, Python) plus the shared `schema/` catalog and a parity
harness. Vendored to drive `langgraph-flow.md` step 6 (fingerprint each cloned repo →
`.harness/fingerprints.json`).

**Source repo:** `git@github.com:multistageharness/tools-RepositoryFingerprint.git`
(clone with the `id_ed25519_multistageharness` deploy key).

**Pinned upstream SHA:** `497c44d85d139f3d8977bf8c1c0146f2a4f53bac` (`main`, 2026-07-07 — jq `or`
reserved-word fix + opt-in `--deep`/`--shadow-scan` monorepo mode; filtered split
`b6d021abce980072eab43d1684a66ce4613e0ef0`). Recorded in the squash/merge commits (see
`git log -- harness-repo-package-remediation/vendors/repository-fingerprint`) and echoed in the `git-subtree-split` trailer.
Originally vendored at `4b7306b08009ba53ce16b9c47dce3d8ca5d9e79b` (2026-07-06, filtered split
`72c0629`).

**What the mirror excludes:** the upstream repo's own nested `.ai` submodule gitlink and its
`.gitmodules` are filtered out of the vendored tree (they are session-storage plumbing, not part of
the tool), so the mirror carries no phantom submodule reference. Everything else — `packages/`,
`schema/`, `scripts/`, `fixtures/`, `README.md`, `.github/` — is vendored verbatim. Upstream
`.gitignore` keeps `packages/ts/dist/` and all `node_modules/` out of the tracked tree.

**Which implementation the integration uses:** the **bash presence-scanner**
(`packages/bash/repo-fingerprint.sh`) — dependency-free (needs only `bash`, `jq`, `find`), so it runs
offline with no npm install and no build step (the TS/Python twins need installed dependencies and,
for TS, a `dist/` build that upstream `.gitignore`s). The `commands.repoFingerprint` atom in the
sibling `langgraph-harness-integration/` pack invokes it as an argv-list subprocess against each
cloned repo dir; the matrix path is resolved by the script relative to itself (overridable via the
`RF_MATRIX` env var).

**Pristine-mirror rule:** same as `langgraph-harness/` above — treat
`vendors/repository-fingerprint/` as read-only upstream. Do **not** add integration atoms/config/flows
inside it; that belongs in the sibling `langgraph-harness-integration/` pack so a future
`git subtree pull` stays a clean fast-forward.

## `tools-cli-progress-bar/`

**What it is:** a dependency-free ESM **CLI progress-bar** library (`ProgressBar`,
`CLIProgressHelper`, `Spinner`) — renders a terminal stage bar plus a spinner using only Node
built-ins (no build step, no runtime deps). Vendored to drive the `flow` wizard's stage-progress
indicator ("stage X of N") — change record `0010` under
[`repo-remediation-pipeline-…/changelogs/`](../../.ai/agile/).

**Source:** upstream repo `carlosmarte/npm-cli-progressor`, published to npm as
`@thinkeloquent/cli-progressor@1.0.2` (ESM, `type: module`, zero runtime deps, `engines.node >= 16`).

**Pinned upstream point:** npm **version `1.0.2`** (tarball shasum `cd3d0047fe540373f73c7b29b700a9080c3d7fed`).
Unlike the two `git subtree` mirrors above, the upstream Git SHA is not published to npm, so this tool
is vendored as a **pristine source copy** from the registry tarball (`npm pack`) and pinned to the
version + tarball digest — recorded in [`tools-cli-progress-bar/VENDOR.md`](tools-cli-progress-bar/VENDOR.md).
The only edit is the `package.json` `name` rename `@thinkeloquent/cli-progressor` →
**`@internal/tools-cli-progress-bar`**; every other file (`main.mjs`, the upstream tests) is verbatim.

**How the integration uses it:** imported **in-process by relative path** through the single bridge
`langgraph-harness-integration/src/progress-lib.mjs` (mirroring `src/fingerprint-lib.mjs` /
`src/snapshot-lib.mjs`) — **not** a declared dependency, never resolved from a registry. The clack
prompter binding renders the real bar; the scripted test binding no-ops the seam to a transcript line,
so the wizard stays TTY-free and offline in tests.

**Pristine-mirror rule:** same as the tools above — read-only upstream; integration code lives only in
the sibling `langgraph-harness-integration/` pack (behind `src/progress-lib.mjs`).

## `claude-sdk/` and `github-sdk/` — **symlinks, not mirrors**

**What they are:** the two internal LLM harness SDKs, both presenting the *same* public surface
(`createHarness({config}, deps)` → `chat()` / `stream()` / `structured()` / `registerTool()` /
`usageSummary()` / `stop()`, with `defaults < config file < env < overrides` precedence, a
JSON-Schema validate→repair loop, a token budget, retries + timeout, and OTel golden signals).
That shared surface is why ONE adapter serves both.

| link | target | package |
|---|---|---|
| `claude-sdk` | `../../../INTERNAL-llm-sdk/claude-sdk/v100` | `llm-sdk-anthropic` (Anthropic Messages API) |
| `github-sdk` | `../../../INTERNAL-llm-sdk/github-sdk/v300` | `llm-sdk-github-copilot` (GitHub Copilot SDK) |

**These are the one exception to everything above.** Every other entry here is a pristine
mirror pinned to an upstream SHA or tarball digest. These two are **relative symlinks into a
sibling checkout** (`../<sibling>` of this repo — never an absolute host path), committed as
mode `120000`: what git stores is the *link*, not the code.

| | subtree / source mirror | symlink |
|---|---|---|
| Content in this repo | yes (pinned) | **no** — a dangling link for anyone without the sibling |
| Reproducible clone / CI | yes | **no** — a fresh clone cannot run the SDK lane |
| Edit-in-place feedback loop | no (read-only) | **yes** — this is the reason to want it |

That trade-off is deliberate while the SDKs are still moving: an edit in the sibling checkout is
visible to the harness immediately, with no re-vendoring step. Once they settle, converting them
to `git subtree` mirrors is the recommended end state.

**Because the link may not resolve, nothing may assume it does:** the adapter's import is a
**guarded dynamic `import()`**, the default provider stays `mock`, `npm test` / `npm run verify`
stay green with **both links absent** (the adapter suite skips its SDK cases and still runs its
config/absent-SDK cases), and a *requested*-but-absent SDK produces a named `LlmProviderError`
naming the symlink — never a silent mock run.

**Dependency isolation (they are NOT workspace members).** Neither SDK is listed in
`harness-repo-package-remediation/package.json`'s `workspaces` and neither is a declared dependency of any harness package.
They install in **their own roots** (`npm install` inside the sibling checkout), exactly as the
`langgraph-harness` mirror does, and are reached by **relative dynamic import** through the pack's
one bridge (`langgraph-harness-integration/src/llm/sdk-provider.mjs` → `src/sdk.mjs`). Three
concrete reasons, not style:

1. `llm-sdk-anthropic` declares `"@anthropic-ai/sdk": "^0.70.0"` — a **caret range**, which the
   platform's pinned-dependency rule forbids anywhere in the harness workspaces. Keeping the SDK
   out of the workspace tree keeps that range out of the harness lockfile.
2. `llm-sdk-github-copilot` depends on `@github/copilot-sdk`, which **bundles a CLI runtime it
   spawns as a subprocess** — materially heavier than the raw-`fetch` seam, and it should not be
   installed for users who never select `github-sdk`.
3. A symlinked workspace member resolves through its realpath and installs into the *target's*
   `node_modules` — the dependency would live outside the repo anyway, while still polluting the
   harness lockfile. Better to be explicit.

> Both SDK installs go through the machine's local Verdaccio at `localhost:4873`. If Docker is
> down, `npm install` in an SDK root fails `ECONNREFUSED` after a ~70s retry burn — check
> `lsof -ti tcp:4873` first.

**Local edits to the `langgraph-harness` mirror (re-apply after each `subtree pull`).** Beside the
`@v100/*` → `@internal/*` rename recorded above, change record `0062` added three
behavior-preserving edits, all of which keep new provider code *out* of the mirror:

- `sdk/src/compiler/graph-compiler.mjs` — the provider is injectable: `options.llm ?? createLlmProvider(…)`.
  With `options.llm` undefined (every pre-existing caller) the behavior is identical.
- `sdk/src/llm/provider.mjs` — the recognized vocabulary gains `claude-sdk` | `github-sdk`, which the
  factory never constructs; it only reports the truth ("requires the harness integration pack") for a
  bare CLI run instead of implying a credential problem.
- `sdk/src/index.mjs` — exports `callLlm` (and the provider vocabulary) so a config pack's own skills
  atoms reach the seam through the same helper the built-in atoms use.

## Updating (refreshing the `langgraph-harness` mirror from upstream)

The split ref is derived deterministically from the upstream `v100/` tree, so a refresh is a fixed
recipe — not a rediscovery. From a scratch dir and then the **outer repo root**:

```sh
# 1. Clone (or fetch) the source with the deploy key (full history — do NOT shallow-clone).
GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_multistageharness -o IdentitiesOnly=yes' \
  git clone git@github.com:multistageharness-com/INTERNAL_use-cases-harness-langgraph.git /path/to/v100-src

# 2. Produce the vendorable `v100-only` ref (tree root == upstream v100/).
#    Preferred: git subtree split --prefix=v100 -b v100-only   (run inside the clone)
#    NOTE: upstream history contains a subtree-join ("Squashed 'vendors/…'") commit that makes
#    `git subtree split` fail with "no new revisions were found". When it does, derive the ref
#    deterministically from the current v100/ tree instead:
git -C /path/to/v100-src branch -D v100-only 2>/dev/null || true
SHA=$(git -C /path/to/v100-src rev-parse HEAD)
TREE=$(git -C /path/to/v100-src rev-parse HEAD:v100)
COMMIT=$(git -C /path/to/v100-src commit-tree "$TREE" -m "Split v100/ subtree from source $SHA")
git -C /path/to/v100-src branch v100-only "$COMMIT"

# 3. Point the `v100-src` remote at the clone (re-point on a fresh machine — it is a LOCAL path)
#    and pull the update, squashed, from the OUTER repo root.
git remote add v100-src /path/to/v100-src 2>/dev/null || git remote set-url v100-src /path/to/v100-src
git fetch v100-src v100-only
git subtree pull --prefix=harness-repo-package-remediation/vendors/langgraph-harness v100-src v100-only --squash
```

If the outer working tree is dirty only because of an unrelated dirty submodule (e.g. `.ai`),
`git subtree`'s dirty-tree guard will refuse. Clear it for the operation with
`git update-index --assume-unchanged <submodule>` (and `--no-assume-unchanged` afterward) — this
does not touch the submodule's contents.

After a pull, re-run the in-place verify above and update the pinned SHA in this file.
