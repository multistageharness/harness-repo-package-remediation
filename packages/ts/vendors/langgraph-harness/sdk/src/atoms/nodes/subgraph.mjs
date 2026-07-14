/**
 * nodes.subgraph — embed another flow config as ONE node of this graph.
 * The child compiles through the same yaml → mapping → registry → execute
 * pipeline (same registry instance, fresh state), with `map_in` seeding the
 * child's channels from the parent and `map_out` harvesting results back.
 * Child diagnostics (error_logs) are folded into the parent's.
 */

import { isAbsolute, resolve } from "node:path";

export const meta = {
  name: "nodes.subgraph",
  category: "nodes",
  summary: "Compile + embed a child flow config as one node (map_in/map_out).",
  params: {
    type: "object",
    required: ["config"],
    properties: {
      config: { type: "string", minLength: 1 },
      map_in: { type: "object" },
      map_out: { type: "object" },
    },
  },
  returns: "node",
};

export function subgraph(params, ctx) {
  const childPath = isAbsolute(params.config) ? params.config : resolve(ctx.options.baseDir, params.config);
  let childReady = null;
  return async (state) => {
    // lazy-compile once per parent compilation; recursion depth is bounded
    // by the compiler's subgraph_depth option (default 3).
    //
    // The null-check and the assignment MUST stay in the same synchronous tick:
    // a parent fan-out (nodes.fanout → Send) re-enters this body once per item,
    // all concurrently. Any `await` between the test and the set lets every
    // branch see `childReady == null` and compile its own child graph — which in
    // turn gives each branch its own copy of every child node's factory closure,
    // silently defeating the in-node serialization those atoms rely on (e.g.
    // commands.venvSetup's provisionChain → N concurrent `python -m venv` on one
    // path). So the dynamic imports (needed to break the compiler↔atoms import
    // cycle) live INSIDE the memoized promise, never in front of it.
    if (childReady == null) {
      childReady = (async () => {
        const { compileFlow } = await import("../../compiler/graph-compiler.mjs");
        const { loadFlowConfig } = await import("../../loader/config-loader.mjs");
        const { config } = await loadFlowConfig(childPath, { env: ctx.options.env });
        return compileFlow(config, {
          registry: ctx.registry,
          options: {
            ...ctx.options,
            baseDir: config.meta.dir,
            subgraphDepth: (ctx.options.subgraphDepth ?? 0) + 1,
          },
          onEvent: (event) => ctx.emit(event.type, { ...event, subgraph: ctx.node?.id }),
        });
      })();
    }
    const child = await childReady;

    const childInput = {};
    for (const [childChan, parentChan] of Object.entries(params.map_in ?? {})) {
      childInput[childChan] = state[parentChan];
    }
    const result = await child.graph.invoke(childInput, {
      recursionLimit: child.config.runtime.recursion_limit,
      configurable: { thread_id: `${ctx.options.threadId ?? "run"}:${ctx.node?.id}` },
    });

    const delta = {};
    for (const [parentChan, childChan] of Object.entries(params.map_out ?? {})) {
      delta[parentChan] = result[childChan];
    }
    if (Array.isArray(result.error_logs) && result.error_logs.length > 0) {
      delta.error_logs = result.error_logs.map((e) => `[subgraph:${ctx.node?.id}] ${e}`);
    }
    return delta;
  };
}
