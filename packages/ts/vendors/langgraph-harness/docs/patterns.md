# langgraph-langchain-harness pattern reference (generated)

> Generated from the live registry by `npm run docs` — cannot drift from
> what a flow config can actually `uses:`. One atomic file per pattern.

**49 patterns across 9 categories.**

## `prompt.*` — 4 patterns

Prompt builders — every way a flow turns config + state into system/user messages.

| pattern | module | summary |
| --- | --- | --- |
| `prompt.chat` | `@internal/langgraph-langchain-harness-sdk/atoms/prompt/chat.mjs` | LangChain ChatPromptTemplate from config messages (native {var} placeholders). |
| `prompt.fewShot` | `@internal/langgraph-langchain-harness-sdk/atoms/prompt/few-shot.mjs` | LangChain FewShotPromptTemplate: prefix + worked examples + suffix. |
| `prompt.file` | `@internal/langgraph-langchain-harness-sdk/atoms/prompt/file.mjs` | Load a .md prompt file (front-matter + # system/# user) and bind {{vars}}. |
| `prompt.system` | `@internal/langgraph-langchain-harness-sdk/atoms/prompt/system.mjs` | Inline system + user prompt strings with {{var}} binding. |

## `template.*` — 4 patterns

Deterministic renderers for reports and artifacts.

| pattern | module | summary |
| --- | --- | --- |
| `template.handlebars` | `@internal/langgraph-langchain-harness-sdk/atoms/template/handlebars.mjs` | Load a .hbs/.md template file; render {{var}} / {{#if}} / {{#each}} sections. |
| `template.interpolate` | `@internal/langgraph-langchain-harness-sdk/atoms/template/interpolate.mjs` | Render an inline {{var}} template string against a scope. |
| `template.jsonReport` | `@internal/langgraph-langchain-harness-sdk/atoms/template/json-report.mjs` | Pick configured scope channels into a stable sorted-key JSON document. |
| `template.markdownReport` | `@internal/langgraph-langchain-harness-sdk/atoms/template/markdown-report.mjs` | Config-declared markdown report: title + sections pulled from scope values. |

## `skills.*` — 6 patterns

LLM reasoning atoms (the Agent half of Agent + Helpers).

| pattern | module | summary |
| --- | --- | --- |
| `skills.classify` | `@internal/langgraph-langchain-harness-sdk/atoms/skills/classify.mjs` | LLM classification into an enum of labels; label → out, verdict → out_detail. |
| `skills.extract` | `@internal/langgraph-langchain-harness-sdk/atoms/skills/extract.mjs` | LLM extraction: text → T[] items, each re-validated (drop-invalid). |
| `skills.generate` | `@internal/langgraph-langchain-harness-sdk/atoms/skills/generate.mjs` | LLM generation: prompt + input channels → prose or structured output channel. |
| `skills.judge` | `@internal/langgraph-langchain-harness-sdk/atoms/skills/judge.mjs` | LLM-as-judge: compare channel A vs channel B on criteria → verdict channel. |
| `skills.summarize` | `@internal/langgraph-langchain-harness-sdk/atoms/skills/summarize.mjs` | LLM summary of input channels into a bounded prose channel. |
| `skills.summarizeSection` | `./patterns/summarize-section.mjs` | Summarize one fanout item; join keyed-by-index into a merge channel. |

## `commands.*` — 10 patterns

Precision code I/O atoms (the Helpers half — argv shell, fs, http, git).

| pattern | module | summary |
| --- | --- | --- |
| `commands.emitKeyed` | `@internal/langgraph-langchain-harness-sdk/atoms/commands/emit-keyed.mjs` | Emit {key: value} into a merge-reducer channel (the deterministic fanout join). |
| `commands.fsList` | `@internal/langgraph-langchain-harness-sdk/atoms/commands/fs-list.mjs` | Recursive sorted file listing of a directory into a channel. |
| `commands.fsRead` | `@internal/langgraph-langchain-harness-sdk/atoms/commands/fs-read.mjs` | Read a text file into a channel (relative paths resolve against the flow dir). |
| `commands.fsWrite` | `@internal/langgraph-langchain-harness-sdk/atoms/commands/fs-write.mjs` | Atomic file write of a channel's content; dry_run logs-and-skips. |
| `commands.gitClone` | `@internal/langgraph-langchain-harness-sdk/atoms/commands/git-clone.mjs` | git clone (argv-list, idempotent, mock-aware) → repo dir into a channel. |
| `commands.httpFetch` | `@internal/langgraph-langchain-harness-sdk/atoms/commands/http-fetch.mjs` | HTTP GET → {status, body} into a channel (deterministic fixture under mock). |
| `commands.popQueue` | `./patterns/pop-queue.mjs` | Pop the head of an array channel; head → head_into, tail → queue channel. |
| `commands.readJson` | `@internal/langgraph-langchain-harness-sdk/atoms/commands/read-json.mjs` | Parse a JSON/YAML data file into a channel (queue seeds, fixtures). |
| `commands.renderReport` | `@internal/langgraph-langchain-harness-sdk/atoms/commands/render-report.mjs` | Render a template.* pattern against state → atomic artifact write → path into channel. |
| `commands.shell` | `@internal/langgraph-langchain-harness-sdk/atoms/commands/shell.mjs` | Run an argv-list subprocess (shell-injection impossible); result into a channel. |

## `knowledge.*` — 5 patterns

The offline deterministic RAG lane: load → chunk → embed → index → retrieve.

| pattern | module | summary |
| --- | --- | --- |
| `knowledge.chunk` | `@internal/langgraph-langchain-harness-sdk/atoms/knowledge/chunk.mjs` | Split [{id, text}] docs into overlapping chunks [{id, doc_id, text}]. |
| `knowledge.embed` | `@internal/langgraph-langchain-harness-sdk/atoms/knowledge/embed.mjs` | Attach deterministic hash-trigram embedding vectors to chunks. |
| `knowledge.loadDocuments` | `@internal/langgraph-langchain-harness-sdk/atoms/knowledge/load-documents.mjs` | Read a directory of .md/.txt documents into [{id, path, text}]. |
| `knowledge.retrieve` | `@internal/langgraph-langchain-harness-sdk/atoms/knowledge/retrieve.mjs` | Cosine top-k retrieval from a named store into a channel. |
| `knowledge.vectorStore` | `@internal/langgraph-langchain-harness-sdk/atoms/knowledge/vector-store.mjs` | Build a named in-memory cosine store from embedded chunks (+ JSON snapshot). |

## `nodes.*` — 8 patterns

Graph control shapes: routing, gating, HITL, fan-out markers, subgraphs, agents.

| pattern | module | summary |
| --- | --- | --- |
| `nodes.agent` | `@internal/langgraph-langchain-harness-sdk/atoms/nodes/agent.mjs` | Bounded reason→act→observe agent over registered command-atom tools (dual failsafe). |
| `nodes.fanout` | `@internal/langgraph-langchain-harness-sdk/atoms/nodes/fanout.mjs` | Fan-out marker: records dispatch cardinality; edges.fanout emits the Send[]. |
| `nodes.gate` | `@internal/langgraph-langchain-harness-sdk/atoms/nodes/gate.mjs` | Schema-validate a channel → boolean <channel>_ok flag (+ issue diagnostics). |
| `nodes.interrupt` | `@internal/langgraph-langchain-harness-sdk/atoms/nodes/interrupt.mjs` | HITL pause: interrupt({message, payload}); resume value → into channel. |
| `nodes.llm` | `@internal/langgraph-langchain-harness-sdk/atoms/nodes/llm.mjs` | Generic LLM node: prompt + inputs → (structured) output channel. |
| `nodes.passthrough` | `@internal/langgraph-langchain-harness-sdk/atoms/nodes/passthrough.mjs` | Write constants (set) and channel copies (copy) into state. |
| `nodes.router` | `@internal/langgraph-langchain-harness-sdk/atoms/nodes/router.mjs` | Ordered when-rules → routing token channel (switch edges read it). |
| `nodes.subgraph` | `@internal/langgraph-langchain-harness-sdk/atoms/nodes/subgraph.mjs` | Compile + embed a child flow config as one node (map_in/map_out). |

## `edges.*` — 5 patterns

Topology wiring: how edge descriptors become LangGraph edges.

| pattern | module | summary |
| --- | --- | --- |
| `edges.conditional` | `@internal/langgraph-langchain-harness-sdk/atoms/edges/conditional.mjs` | Predicate edge {from, when, to, else} → addConditionalEdges. |
| `edges.fanout` | `@internal/langgraph-langchain-harness-sdk/atoms/edges/fanout.mjs` | Send-API fan-out over an array channel + join edge (branch channels <over>_item/_index). |
| `edges.linear` | `@internal/langgraph-langchain-harness-sdk/atoms/edges/linear.mjs` | Linear edge {from, to} → StateGraph.addEdge. |
| `edges.loop` | `@internal/langgraph-langchain-harness-sdk/atoms/edges/loop.mjs` | Bounded loop edge: synthetic guard node + hidden counter; max always wins. |
| `edges.switch` | `@internal/langgraph-langchain-harness-sdk/atoms/edges/switch.mjs` | Switch edge on a channel value {on, cases, default} → addConditionalEdges. |

## `condition.*` — 4 patterns

Safe predicates/routers compiled from the closed expression grammar.

| pattern | module | summary |
| --- | --- | --- |
| `condition.always` | `@internal/langgraph-langchain-harness-sdk/atoms/condition/always.mjs` | Constant predicate (true unless value: false). |
| `condition.expression` | `@internal/langgraph-langchain-harness-sdk/atoms/condition/expression.mjs` | Safe closed-grammar predicate over state (==, !=, <, >, &&, ||, !, in, state.x.y). |
| `condition.switchOn` | `@internal/langgraph-langchain-harness-sdk/atoms/condition/switch-on.mjs` | Route on a channel value: cases map + default fallback. |
| `condition.truthy` | `@internal/langgraph-langchain-harness-sdk/atoms/condition/truthy.mjs` | Predicate: is a channel truthy (non-empty array/string, true, non-zero)? |

## `checkpoints.*` — 3 patterns

Thread persistence strategies (none / in-memory / durable file).

| pattern | module | summary |
| --- | --- | --- |
| `checkpoints.file` | `@internal/langgraph-langchain-harness-sdk/atoms/checkpoints/file.mjs` | Durable JSON-file checkpointer — threads survive process restarts. |
| `checkpoints.memory` | `@internal/langgraph-langchain-harness-sdk/atoms/checkpoints/memory.mjs` | In-process MemorySaver — enables interrupt/resume for the process lifetime. |
| `checkpoints.none` | `@internal/langgraph-langchain-harness-sdk/atoms/checkpoints/none.mjs` | No checkpointer — pure pipeline, no thread state. |
