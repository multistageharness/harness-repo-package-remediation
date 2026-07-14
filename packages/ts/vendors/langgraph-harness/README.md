# langgraph-langchain-harness — enterprise config-driven LangChain + LangGraph platform

langgraph-langchain-harness consolidates every LangChain/LangGraph pattern used across the ~47
`../projects/` examples into one platform with an **atomic architecture**:
every pattern is a **dedicated file exposing one function**, and flows are
**pure yaml** compiled through four stages:

```
┌────────┐    ┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  yaml  │ →  │   mapping   │ →  │     registry     │ →  │     execute     │
│ (flow) │    │ name→module │    │ dynamic import() │    │ StateGraph.run  │
└────────┘    └─────────────┘    └──────────────────┘    └─────────────────┘
 configs/      mapping.yaml       verifies the atom       LangGraph invoke
 flows/*.yaml  (+ extends)        contract, caches        + events + threads
```

A flow names patterns (`uses: skills.classify`); the **mapping** yaml resolves
each name to a Node ESM module + export; the **registry** `import()`s and
verifies it; the **compiler** wires the graph; the **executor** runs it. Adding
capability = adding one file + one mapping line.

Four shipped surfaces, all tested:

| surface | package | what it is |
|---|---|---|
| **sdk** | `@internal/langgraph-langchain-harness-sdk` | the pipeline + 47 built-in atoms across 9 categories |
| **backend** | `@internal/langgraph-langchain-harness-backend` | Fastify API — flows, patterns, runs (SSE live streaming), durable threads, optional bearer auth, static frontend hosting |
| **cli** | `@internal/langgraph-langchain-harness-cli` | `langgraph-langchain-harness list · patterns · validate · graph · run · resume` |
| **frontend** | `@internal/langgraph-langchain-harness-frontend` | Vite console — flow catalog, topology SVG viewer, live run panel (EventSource), interrupt→resume UI, pattern browser, run history |

## Quick start

```bash
cd langgraph-harness
npm install                  # workspaces install (pinned versions)
npm run verify               # all 4 test suites + the 9-example acceptance sweep + docs
                             # (make install / make verify are equivalents where make exists)

# CLI
node cli/src/main.mjs list
node cli/src/main.mjs run linear-rag --events
node cli/src/main.mjs run hitl-approval            # → INTERRUPTED thread=run-…
node cli/src/main.mjs resume hitl-approval --thread <id> --resume-json '{"approve":true}'

# Backend + console
npm run build -w frontend    # build the console once
npm run serve                # http://127.0.0.1:7100  (API under /api/*)
```

Everything runs **offline by default** (`mock: true`): the LLM seam returns
deterministic FNV-keyed stubs, schema-constrained calls return schema-valid
skeletons, and network/git/subprocess commands return fixtures. Real model
access is env-switched (`LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`,
or `LANGGRAPH_LANGCHAIN_HARNESS_LLM_PROVIDER=openai` + `LANGGRAPH_LANGCHAIN_HARNESS_LLM_BASE_URL`) — no code changes.

## The nine atom categories (47 built-ins + project customs)

| category | patterns |
|---|---|
| `prompt` | file (front-matter .md), system, chat (LangChain ChatPromptTemplate), fewShot (FewShotPromptTemplate) |
| `template` | interpolate, handlebars (closed micro-engine), markdownReport, jsonReport |
| `skills` | generate, classify, extract (drop-invalid), summarize, judge |
| `commands` | shell (argv-list), httpFetch, fsRead, fsWrite (atomic), fsList, readJson, gitClone, renderReport, emitKeyed |
| `knowledge` | loadDocuments, chunk, embed (deterministic FNV-trigram), vectorStore, retrieve — the offline RAG lane |
| `nodes` | llm, passthrough, router, gate, interrupt (HITL), fanout, subgraph, agent (dual-failsafe loop) |
| `edges` | linear, conditional, switch, loop (bounded guard), fanout (Send API) |
| `condition` | expression (closed grammar), switchOn, truthy, always |
| `checkpoints` | none, memory, **file** (durable JSON threads — resume in another process) |

Full generated reference: [`docs/patterns.md`](docs/patterns.md) (`make docs`).

## The flow DSL (one page)

```yaml
version: 100
name: retry-draft-gate
runtime: { recursion_limit: 50, checkpointer: none, mock: ${MOCK:true} }
env: [{ name: ANSWER_MODEL, default: mock-model }]
types:
  SpecDoc: { type: object, required: [title, steps], properties: { … } }
state:                              # typed channels + reducer (last|concat|merge|add)
  ticket:  { type: string, default: "…" }
  spec:    { type: object, default: {} }
  spec_ok: { type: boolean, default: false }
entry: draft_spec
nodes:
  - id: draft_spec
    uses: skills.generate           # ← pattern name, resolved via the mapping
    with: { prompt: "../prompts/draft_spec.md", input: { ticket: ticket }, out: spec }
    reads: [ticket]                 # input gate
    writes: [spec]                  # write filter — can ONLY write these
    validate: { schema: SpecDoc, on_invalid: degrade, fallback: {} }
  - id: spec_gate
    uses: nodes.gate
    with: { channel: spec, schema: SpecDoc }
edges:
  - { from: draft_spec, to: spec_gate }
  - loop: { from: spec_gate, body_from: draft_spec,        # bounded retry
            until: "state.spec_ok == true", max: 2, on_max: publish }
```

Edge shapes (recognized by structure): `{from,to}` linear ·
`{from,when,to,else}` conditional · `{from,switch:{on,cases,default}}` switch ·
`{loop:{from,body_from,until,max,on_max}}` bounded loop ·
`{from,fanout:{over,to,carry},then}` Send fan-out · `{uses,with}` custom edge atom.

The 10 example flows in [`configs/flows/`](configs/flows) cover all **8
topology archetypes** (LIN, LIN+C, DISP, RETRY, QUEUE, FANOUT, HITL, AGENT)
plus subgraph composition, and every one runs end-to-end under mock.

## Guarantees (enforced by the harness, not by config authors)

- **Closed expression grammar** — `when`/`until` compile from an AST with no
  call/index/assignment nodes; `require(...)`/`process.env` are unrepresentable.
- **Bounded loops** — every `loop` edge injects a synthetic guard + hidden
  add-reducer counter; the bound always wins over `until`. `nodes.agent`
  additionally enforces `max_attempts` AND `deadline_s`.
- **Write filter** — a node physically cannot write channels it didn't declare.
- **Validate gates** — 14 config-time invariants with precise paths
  (`nodes[3].with.model`); runtime output schemas with `raise | degrade`.
- **Trust boundary** — custom pattern modules load only from the mapping file's
  subtree; `../` escapes and foreign bare specifiers throw `TRUST_BOUNDARY`.
- **Argv-list shell** — no string ever reaches a shell parser.
- **Redaction** — token-shaped values are masked in every event/log/API payload.
- **Durable HITL** — `checkpoints.file` persists threads atomically; an
  interrupted flow resumes in a different process (proven in the CLI tests).

## Testing

```bash
npm run verify          # everything below, plus docs regeneration
npm test                # sdk 57 · backend 13 · cli 10 · frontend 11 = 91 tests
npm run run-examples    # the 9-flow offline acceptance sweep
```

See [`docs/validation.md`](docs/validation.md) for the full validation report,
[`docs/architecture.md`](docs/architecture.md) for the deep dive, and
[`logs/`](logs) for the decision trail.
