/**
 * edges.switch — `{from, switch: {on, cases, default}}` → addConditionalEdges
 * routing on a channel's value via condition.switchOn (through the registry).
 * The DISP archetype and every meta-router.
 */

export const meta = {
  name: "edges.switch",
  category: "edges",
  summary: "Switch edge on a channel value {on, cases, default} → addConditionalEdges.",
  params: {
    type: "object",
    required: ["from", "on", "cases"],
    properties: {
      from: { type: "string" },
      on: { type: "string" },
      cases: { type: "object" },
      default: { type: "string" },
    },
  },
  returns: "edge",
};

export async function switchEdge(edge, ctx) {
  const { factory } = await ctx.registry.resolve("condition.switchOn");
  const route = factory({ on: edge.on, cases: edge.cases, default: edge.default }, ctx);
  return {
    wire(g, helpers) {
      const targets = new Set(Object.values(edge.cases));
      if (edge.default !== undefined) targets.add(edge.default);
      const pathMap = {};
      for (const target of targets) pathMap[target] = helpers.mapTarget(target);

      g.addConditionalEdges(
        edge.from,
        (state) => {
          const target = route(state);
          if (target === undefined) {
            throw new Error(`switch on '${edge.on}': value '${state[edge.on]}' matches no case and no default is declared`);
          }
          ctx.emit("edge.route", { from: edge.from, on: edge.on, value: String(state[edge.on] ?? ""), to: target });
          return target;
        },
        pathMap,
      );
      for (const [caseKey, target] of Object.entries(edge.cases)) {
        helpers.topology.push({ from: edge.from, to: target, kind: "switch", label: `${edge.on}=${caseKey}` });
      }
      if (edge.default !== undefined) {
        helpers.topology.push({ from: edge.from, to: edge.default, kind: "switch", label: "default" });
      }
    },
  };
}
