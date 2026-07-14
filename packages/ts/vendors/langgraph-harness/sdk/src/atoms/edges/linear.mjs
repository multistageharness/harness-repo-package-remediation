/**
 * edges.linear — `{from, to}` → one addEdge. The LIN archetype's bricks.
 */

export const meta = {
  name: "edges.linear",
  category: "edges",
  summary: "Linear edge {from, to} → StateGraph.addEdge.",
  params: {
    type: "object",
    required: ["from", "to"],
    properties: { from: { type: "string" }, to: { type: "string" } },
  },
  returns: "edge",
};

export function linear(edge) {
  return {
    wire(g, helpers) {
      g.addEdge(edge.from, helpers.mapTarget(edge.to));
      helpers.topology.push({ from: edge.from, to: edge.to, kind: "linear" });
    },
  };
}
