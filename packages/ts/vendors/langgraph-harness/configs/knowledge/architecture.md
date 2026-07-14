# langgraph-langchain-harness architecture

The langgraph-langchain-harness platform compiles declarative yaml flow configs into running
LangGraph state machines. The pipeline has four stages: the yaml loader
parses and normalizes the config, the mapping resolves every pattern name to
a Node ESM module, the registry dynamically imports and verifies each atom,
and the graph compiler wires nodes and edges into a StateGraph that the
executor runs.

Every pattern is an atomic file exposing exactly one factory function plus a
meta descriptor. The nine categories are prompt, template, skills, commands,
knowledge, nodes, edges, condition, and checkpoints.

State is typed channels with four reducers: last, concat, merge, and add.
The two diagnostics channels error_logs and last_step are injected into every
flow automatically.
