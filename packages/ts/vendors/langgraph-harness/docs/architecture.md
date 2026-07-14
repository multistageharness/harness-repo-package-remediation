# langgraph-langchain-harness architecture

## The pipeline in five modules

| stage | module | in → out |
|---|---|---|
| 1. yaml | `sdk/src/loader/config-loader.mjs` | flow file → parsed, `${VAR:default}`-interpolated, **normalized** config (edge shapes tagged, diagnostics channels injected, checkpointer shorthand resolved, interrupt ⇒ auto-memory) |
| gate | `sdk/src/loader/validate.mjs` | normalized config → 14 invariants (I1–I14), each issue with a precise path |
| 2. mapping | `sdk/src/mapping/mapping-loader.mjs` | mapping yaml (+`extends` chain) → `Map<patternName, {module, export, category, file}>`, trust-boundary enforced |
| 3. registry | `sdk/src/registry/registry.mjs` | pattern name → **dynamic `import()`** → contract-verified factory (`meta.name`/`meta.category` must agree), cached |
| 4. execute | `sdk/src/compiler/graph-compiler.mjs` → `sdk/src/executor/executor.mjs` | config + registry → `StateGraph` (Annotation from state factory, bodies wrapped in the boundary ritual, edges wired by edge atoms, checkpointer atom) → `runFlow`/`resumeFlow` with the event envelope |

## The atom contract

Every pattern is one `.mjs` file:

```js
export const meta = {
  name: "skills.classify",      // must equal the mapping key
  category: "skills",           // must equal the mapping category
  summary: "…",
  params: { /* mini-json-schema for `with` — compile-time validated */ },
  returns: "node",              // node | edge | condition | checkpointer | prompt | template
};
export function classify(params, ctx) { /* factory */ }
```

Factory context (`ctx`): `{flow, node, services{logger,shell,fs}, llm, registry,
options{mock,dryRun,baseDir,env,threadId}, stores, emit}`. Factories may be
async. What a factory returns depends on the category:

- **skills / commands / knowledge / nodes** → a node body `async (state) => delta`
- **edges** → `{wire(graph, helpers), channels?, syntheticNodes?}`
- **condition** → `(state) => boolean | token`
- **checkpoints** → a checkpointer instance (or null)
- **prompt** → `async (vars) => {system, user}`
- **template** → `(scope) => string`

Atoms compose **through the registry** — `skills.*` resolve `prompt.file`,
`commands.renderReport` resolves `template.*`, `nodes.agent` resolves its
tools (`commands.*` only), `edges.conditional` resolves `condition.expression`.
The mapping is therefore the single seam for extension AND override: a project
mapping can re-point any built-in name at its own file.

## The wrap-node boundary ritual

Every node body — built-in or custom — is composed inside
`sdk/src/compiler/wrap-node.mjs`:

1. input gate (declared `reads` must be present)
2. bounded retry (`retry: {max, delay_ms}`)
3. **write filter** (delta narrowed to declared `writes` + diagnostics)
4. validate gate (`validate.schema` → `raise | degrade`+fallback)
5. error policy (`on_error: raise | continue` → `error_logs` + `last_step`)
6. `last_step` stamp + `node.start/end/error/retry` events

LangGraph control-flow exceptions (interrupt/Command) pass through untouched —
that is the HITL mechanism, not an error.

## State model

Channels: `{type, default, reducer}` with reducers `last · concat · merge · add`
(the corpus-complete set). Two injected diagnostics channels: `error_logs`
(concat) and `last_step` (last). Loop edges inject hidden `__loop_<from>`
add-counters; `__`-prefixed names are reserved and validator-enforced.

## Events

A closed 15-type taxonomy (`sdk/src/events/events.mjs`): run.start/end/error/
interrupted/resumed, node.start/end/error/retry, llm.call/result, edge.route,
loop.guard, fanout.dispatch, checkpoint.save. Every payload passes the
redactor. One hub per compiled flow; consumers: CLI `--events`, backend SSE,
frontend live log, and the tests' assertions.

## Surfaces

- **backend** (`backend/src/app.mjs`) — routes over the SDK with a stable error
  envelope (`{error: {code, message, details, request_id}}`), LanggraphLangchainHarnessError→HTTP
  status mapping, optional bearer auth (`LANGGRAPH_LANGCHAIN_HARNESS_API_TOKEN`), SSE streaming
  (`GET /api/flows/:name/runs/stream`), thread inspection/resume, an in-memory
  run store, and dependency-free static hosting of `frontend/dist` with SPA
  fallback + traversal guard.
- **cli** (`cli/src/main.mjs`) — same SDK, exit codes 0/1/2/3, `--json`
  machine output, `--events` live log; `run`/`resume` prove durable HITL
  across processes via `checkpoints.file`.
- **frontend** (`frontend/src/`) — no framework; pure modules
  (`graph-layout.js`, `api.js`) are node-tested; the console renders the
  topology SVG (layered layout, synthetic guards dashed, loop-backs curved),
  streams runs via EventSource, and drives interrupt→resume.

## Provenance

Design lineage: the `langgraph-config-harness` reference project (config DSL,
expression grammar, wrap ritual, 8 archetypes, mock contract) evolved to the
atomic mapping/registry architecture; corpus patterns folded in per category —
see `logs/decisions.md` D1–D10 and the survey notes in `logs/plan.md`.
