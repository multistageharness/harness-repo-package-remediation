/**
 * edges.conditional — `{from, when, to, else}` → addConditionalEdges with a
 * predicate compiled by condition.expression THROUGH the registry (the edge
 * composes the condition atom; nothing evaluates config text directly).
 */

export const meta = {
  name: "edges.conditional",
  category: "edges",
  summary: "Predicate edge {from, when, to, else} → addConditionalEdges.",
  params: {
    type: "object",
    required: ["from", "when", "to"],
    properties: {
      from: { type: "string" },
      when: { type: "string" },
      to: { type: "string" },
      else: { type: "string" },
    },
  },
  returns: "edge",
};

export async function conditional(edge, ctx) {
  const { factory } = await ctx.registry.resolve("condition.expression");
  const predicate = factory({ expr: edge.when }, ctx);
  return {
    wire(g, helpers) {
      const elseTarget = edge.else ?? "END";
      const pathMap = {
        [edge.to]: helpers.mapTarget(edge.to),
        [elseTarget]: helpers.mapTarget(elseTarget),
      };
      g.addConditionalEdges(
        edge.from,
        (state) => {
          const target = predicate(state) ? edge.to : elseTarget;
          ctx.emit("edge.route", { from: edge.from, when: edge.when, to: target });
          return target;
        },
        pathMap,
      );
      helpers.topology.push({ from: edge.from, to: edge.to, kind: "conditional", label: edge.when });
      helpers.topology.push({ from: edge.from, to: elseTarget, kind: "conditional", label: `!(${edge.when})` });
    },
  };
}
