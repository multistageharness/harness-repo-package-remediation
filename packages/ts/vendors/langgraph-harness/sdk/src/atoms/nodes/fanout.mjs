/**
 * nodes.fanout — the fan-out marker node. Records the dispatch cardinality
 * (the actual Send[] emission is wired by the edges.fanout atom on this
 * node's outgoing edge). Keeping the node a pure recorder preserves the
 * "conditional edges route, nodes mutate" boundary.
 */

export const meta = {
  name: "nodes.fanout",
  category: "nodes",
  summary: "Fan-out marker: records dispatch cardinality; edges.fanout emits the Send[].",
  params: {
    type: "object",
    required: ["over"],
    properties: {
      over: { type: "string", minLength: 1 },
      count_into: { type: "string" },
    },
  },
  returns: "node",
};

export function fanout(params, ctx) {
  return async (state) => {
    const list = state[params.over];
    const count = Array.isArray(list) ? list.length : 0;
    ctx.emit("fanout.dispatch", { node: ctx.node?.id, over: params.over, count });
    const delta = {};
    if (params.count_into) delta[params.count_into] = count;
    return delta;
  };
}
