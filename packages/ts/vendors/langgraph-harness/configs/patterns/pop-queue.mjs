/**
 * commands.popQueue — CUSTOM pattern (project-local, mapped via
 * configs/mapping.yaml): pop the head of an array channel into `head_into`,
 * write the remainder back, and bump a processed counter. The QUEUE
 * archetype's worker step, and the living proof that the mapping →
 * registry → import() chain loads project files, not just SDK atoms.
 */

export const meta = {
  name: "commands.popQueue",
  category: "commands",
  summary: "Pop the head of an array channel; head → head_into, tail → queue channel.",
  params: {
    type: "object",
    required: ["queue", "head_into"],
    properties: {
      queue: { type: "string", minLength: 1 },
      head_into: { type: "string", minLength: 1 },
      count_into: { type: "string" },
    },
  },
  returns: "node",
};

export function popQueue(params) {
  return async (state) => {
    const queue = Array.isArray(state[params.queue]) ? state[params.queue] : [];
    if (queue.length === 0) {
      return { [params.head_into]: null };
    }
    const [head, ...rest] = queue;
    const delta = { [params.queue]: rest, [params.head_into]: head };
    if (params.count_into) delta[params.count_into] = 1; // add-reducer channel
    return delta;
  };
}
