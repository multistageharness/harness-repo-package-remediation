/**
 * nodes.passthrough — write configured constants (and/or copies of other
 * channels) into state. Seeding, defaulting, fixture injection, join points.
 */

export const meta = {
  name: "nodes.passthrough",
  category: "nodes",
  summary: "Write constants (set) and channel copies (copy) into state.",
  params: {
    type: "object",
    properties: {
      set: { type: "object" },
      copy: { type: "object" },
    },
  },
  returns: "node",
};

export function passthrough(params) {
  return async (state) => {
    const delta = {};
    for (const [channel, value] of Object.entries(params.set ?? {})) delta[channel] = value;
    for (const [toChannel, fromChannel] of Object.entries(params.copy ?? {})) delta[toChannel] = state[fromChannel];
    return delta;
  };
}
