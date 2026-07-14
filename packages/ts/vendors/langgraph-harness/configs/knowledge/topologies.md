# The eight topology archetypes

langgraph-langchain-harness expresses all eight recurring graph shapes declaratively. LIN is a
linear chain of edges. LIN+C adds a conditional short-circuit through a
predicate edge. DISP dispatches at the entry on a mode channel through a
switch edge. RETRY wires a generate node to a gate node and loops back on
failure, bounded by max. QUEUE pops a work queue and loops until the queue
is empty. FANOUT emits one Send branch per array item and joins through a
merge reducer. HITL pauses at an interrupt node until a human resumes the
thread. AGENT runs a bounded reason-act-observe loop with a dual failsafe of
max_attempts and deadline_s.

Loops can never run forever: every loop edge injects a synthetic guard node
with a hidden add-reducer counter, and the bound always wins over the until
predicate.
