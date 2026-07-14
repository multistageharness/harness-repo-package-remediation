# Operating langgraph-langchain-harness

Runs are mock-first: under mock the llm seam returns deterministic FNV-keyed
stubs and every network, git, and subprocess command returns an offline
fixture, so the entire example suite runs with no key and no network.

The dry_run flag exercises real code paths but skips irreversible actions
such as file writes by the report renderer.

Human-in-the-loop flows require a checkpointer. The memory checkpointer
lives for the process lifetime; the file checkpointer persists threads to a
JSON snapshot so an interrupted flow can resume in a different process.

The backend exposes flows, patterns, runs, and threads over HTTP with
server-sent events for live run streaming. The CLI offers list, validate,
graph, patterns, run, and resume commands over the same SDK.
