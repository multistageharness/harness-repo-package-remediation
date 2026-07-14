/**
 * edges.fanout — `{from, fanout: {over, to, carry}, then}` → the Send API:
 * one branch invocation of `to` per item of the `over` array channel, each
 * seeded with `<over>_item` / `<over>_index` (+ carried channels), then a
 * join edge `to → then`. Branch deltas merge back through the declared
 * reducers (merge/concat) — the FANOUT archetype.
 */

import { Send } from "@langchain/langgraph";

export const meta = {
  name: "edges.fanout",
  category: "edges",
  summary: "Send-API fan-out over an array channel + join edge (branch channels <over>_item/_index).",
  params: {
    type: "object",
    required: ["from", "over", "to", "then"],
    properties: {
      from: { type: "string" },
      over: { type: "string" },
      to: { type: "string" },
      carry: { type: "array" },
      then: { type: "string" },
    },
  },
  returns: "edge",
};

export function fanout(edge, ctx) {
  const itemChannel = `${edge.over}_item`;
  const indexChannel = `${edge.over}_index`;
  const declared = ctx.flow.state ?? {};
  for (const required of [itemChannel, indexChannel]) {
    if (!(required in declared)) {
      throw new Error(
        `edges.fanout over '${edge.over}': branch channel '${required}' must be declared in state (the branch node reads it)`,
      );
    }
  }

  return {
    wire(g, helpers) {
      g.addConditionalEdges(
        edge.from,
        (state) => {
          const list = state[edge.over];
          if (!Array.isArray(list) || list.length === 0) {
            ctx.emit("fanout.dispatch", { from: edge.from, over: edge.over, count: 0, note: "empty — skipping to join" });
            return helpers.mapTarget(edge.then) === helpers.END ? "END" : edge.then;
          }
          ctx.emit("fanout.dispatch", { from: edge.from, over: edge.over, count: list.length });
          return list.map((item, index) => {
            const branchState = { [itemChannel]: item, [indexChannel]: index };
            for (const carryChannel of edge.carry ?? []) branchState[carryChannel] = state[carryChannel];
            return new Send(edge.to, branchState);
          });
        },
        { [edge.to]: edge.to, [edge.then]: helpers.mapTarget(edge.then), END: helpers.END },
      );
      g.addEdge(edge.to, helpers.mapTarget(edge.then));

      helpers.topology.push({ from: edge.from, to: edge.to, kind: "fanout", label: `∀ ${edge.over}[i]` });
      helpers.topology.push({ from: edge.to, to: edge.then, kind: "fanout", label: "join" });
    },
  };
}
