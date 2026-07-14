# langgraph-langchain-harness — validation report

Date: 2026-07-06 · Node v24.18.0 · Windows 11 · all runs offline (mock contract)

## Verdict

**All four surfaces implemented, tested, and confirmed.** 91/91 automated
tests pass, all 9 example flows (8 topology archetypes + subgraph composition)
compile and run end-to-end under mock, the generated pattern reference covers
49 patterns (47 built-in + 2 project customs), and the real backend boots and
serves the built console.

## Test matrix

| surface | suite | count | proves |
|---|---|---|---|
| sdk | `sdk/test/expr.test.mjs` | 5 | closed grammar: operators, member access, injection-shapes unrepresentable, channel extraction |
| sdk | `sdk/test/schema.test.mjs` | 4 | mini-json-schema subset + precise paths + schema-valid skeletons (enum-first) |
| sdk | `sdk/test/template.test.mjs` | 5 | template engine (sections, Handlebars-falsy `[]`, no prototype access), prompt-file front-matter + var allowlist |
| sdk | `sdk/test/loader.test.mjs` | 5 | normalization defaults, diagnostics injection, env interpolation + coercion + required, interrupt→auto-checkpointer, edge-shape detection, parse errors |
| sdk | `sdk/test/validate.test.mjs` | 11 | invariants I2–I14 each firing with precise paths |
| sdk | `sdk/test/mapping-registry.test.mjs` | 6 | default mapping completeness, verifyAll over every atom, extends-chain overlays, **trust boundary** (`../` escape + foreign bare specifier rejected), meta-contract enforcement |
| sdk | `sdk/test/runtime.test.mjs` | 11 | write filter, on_error continue/raise, validate gate degrade/raise, **bounded loop forced-exit**, node retry, input gate, **durable file-checkpoint HITL resume in a fresh instance**, compile-time param paths, event sequencing + redaction |
| sdk | `sdk/test/atoms.test.mjs` | 10 | deterministic embedder/cosine ranking, chunker bounds, condition atoms, emitKeyed, report templates, **LangChain ChatPromptTemplate + FewShotPromptTemplate integration**, mock provider determinism + credential fallback, event hub isolation |
| backend | `backend/test/api.test.mjs` | 13 | health/meta/patterns/flows/graph endpoints, 404/409/422 envelopes with request ids, run + **HITL resume over HTTP**, run registry, **bearer auth gating**, **SSE live streaming over a real socket** |
| cli | `cli/test/cli.test.mjs` | 10 | usage/exit codes, list/validate/graph/patterns --verify, `--input` routing, **run→interrupt→resume across SEPARATE OS processes** (file checkpointer), unknown-thread handling, all remaining examples via the CLI |
| frontend | `frontend/test/*.test.mjs` | 11 | pure layout (layers, backward loop edges, determinism, cycle guard), api url builders, **vite build + backend serving dist**, SPA fallback, traversal refusal, **the exact browser run-panel sequence (SSE) end-to-end** |
| **total** | | **91** | |

## Example acceptance sweep (`make run-examples`)

| flow | archetype | result |
|---|---|---|
| linear-rag | LIN + offline RAG lane | PASS (load→chunk→embed→index→retrieve→answer→report) |
| conditional-triage | LIN+C | PASS (mock classifies `noise` → switch short-circuits to END — the archetype's point) |
| dispatch-modes | DISP | PASS (router → switch lane; `--input mode=stats` verified via CLI/API) |
| retry-draft-gate | RETRY | PASS (gate + bounded loop; forced-exit proven separately in sdk tests) |
| queue-worker | QUEUE | PASS (custom `commands.popQueue` drains 3 items, loop exits on empty) |
| fanout-sections | FANOUT | PASS (3 Send branches, custom `skills.summarizeSection`, keyed merge join `s0..s2`) |
| hitl-approval | HITL | PASS (interrupt → resume(approve) → publish; thread durable in `.runs/hitl-threads.json`) |
| agent-remediate | AGENT | PASS (bounded reason→act→observe; dual failsafe; registered tools only) |
| subgraph-parent | subgraph | PASS (child flow compiled through the same pipeline, map_in/map_out) |

## Live boot check

`node backend/src/server.mjs` on :7100 →
`GET /api/health` `{"status":"ok",…}` · `GET /` serves the built console
(`<title>langgraph-langchain-harness console</title>`) · `GET /api/meta` reports 49 patterns /
10 flows / pipeline `yaml→mapping→registry→execute`.

## Pipeline-integrity highlights (what the suite pins down)

1. **yaml→mapping→registry→execute is real dynamic import** — every atom is
   reached via `import()` from mapping entries; `patterns --verify` imports
   all 49 and checks the meta contract.
2. **The trust boundary holds** — `../` module escapes and non-`@internal/langgraph-langchain-harness-*` bare
   specifiers throw `TRUST_BOUNDARY` at mapping load.
3. **No config can loop forever** — guard counter beats `until`; agent has
   `max_attempts` AND `deadline_s`.
4. **HITL is durable** — interrupt in process A, resume in process B through
   the file checkpointer (CLI test), and through HTTP (backend test).
5. **Offline determinism** — FNV-keyed mock LLM, hash-trigram embedder, and
   fixtures make all 91 tests + 9 examples reproducible with no key/network.

## How to re-verify

```bash
cd langgraph-harness
make install
make verify     # npm test (91) + run-examples (9) + docs regeneration
```
