/**
 * edges.loop — the BOUNDED loop: `{loop: {from, body_from, until, max,
 * on_max}}`. Injects a synthetic guard node (`__loop_guard_<from>`) that
 * increments a hidden `__loop_<from>` add-reducer counter, then routes:
 *
 *     until(state) === true  → exit (on_max target)
 *     counter >= max         → exit (FORCED — the bound always wins)
 *     otherwise              → body_from (loop again)
 *
 * Conditional edges cannot mutate state (corpus rule), so the counter
 * increment lives in the guard NODE and the routing in the guard's
 * conditional edge. No config can loop forever: the guard checks the bound
 * BEFORE the predicate can keep the loop alive.
 */

export const meta = {
  name: "edges.loop",
  category: "edges",
  summary: "Bounded loop edge: synthetic guard node + hidden counter; max always wins.",
  params: {
    type: "object",
    required: ["from", "body_from", "max", "on_max"],
    properties: {
      from: { type: "string" },
      body_from: { type: "string" },
      until: { type: "string" },
      max: { type: "integer" },
      on_max: { type: "string" },
    },
  },
  returns: "edge",
};

export async function loop(edge, ctx) {
  let untilPredicate = null;
  if (edge.until) {
    const { factory } = await ctx.registry.resolve("condition.expression");
    untilPredicate = factory({ expr: edge.until }, ctx);
  }
  const guardId = `__loop_guard_${edge.from}`;
  const counterChannel = `__loop_${edge.from}`;

  return {
    wire(g, helpers) {
      // guard node: the ONLY mutation is the hidden counter increment
      g.addNode(guardId, async () => ({ [counterChannel]: 1 }));
      g.addEdge(edge.from, guardId);

      const pathMap = {
        [edge.body_from]: helpers.mapTarget(edge.body_from),
        [edge.on_max]: helpers.mapTarget(edge.on_max),
      };
      g.addConditionalEdges(
        guardId,
        (state) => {
          // count = completed body passes; loop-backs so far = count - 1.
          // `max` bounds the number of LOOP-BACKS: the body runs at most
          // 1 + max times, and the bound always wins over `until`.
          const count = state[counterChannel] ?? 0;
          const exitTarget = edge.on_max;
          if (count > edge.max) {
            ctx.emit("loop.guard", { from: edge.from, count, max: edge.max, decision: "forced-exit" });
            return exitTarget;
          }
          if (untilPredicate && untilPredicate(state)) {
            ctx.emit("loop.guard", { from: edge.from, count, max: edge.max, decision: "until-exit" });
            return exitTarget;
          }
          ctx.emit("loop.guard", { from: edge.from, count, max: edge.max, decision: "loop" });
          return edge.body_from;
        },
        pathMap,
      );

      helpers.topology.push({ from: edge.from, to: guardId, kind: "loop", label: "guard", synthetic: true });
      helpers.topology.push({ from: guardId, to: edge.body_from, kind: "loop", label: `retry ≤ ${edge.max}` });
      helpers.topology.push({ from: guardId, to: edge.on_max, kind: "loop", label: edge.until ? `until ${edge.until}` : "bound" });
    },
    /** Hidden channels this edge needs (the compiler injects them pre-build). */
    channels: { [counterChannel]: { type: "number", default: 0, reducer: "add", injected: true } },
    /** Synthetic nodes this edge contributes (for the topology viewer). */
    syntheticNodes: [{ id: guardId, uses: "edges.loop#guard", synthetic: true }],
  };
}
