/**
 * commands.emitKeyed — the FANOUT join primitive (data.emit_section
 * lineage): write {key: value} into a MERGE-reducer channel, key and value
 * read from channels. Send branches run in the same superstep, so branch
 * results must land through merge/concat reducers — this atom is the keyed
 * form that keeps branch identity (deterministic joins).
 */

export const meta = {
  name: "commands.emitKeyed",
  category: "commands",
  summary: "Emit {key: value} into a merge-reducer channel (the deterministic fanout join).",
  params: {
    type: "object",
    required: ["key_from", "value_from", "into"],
    properties: {
      key_from: { type: "string", minLength: 1 },
      value_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      prefix: { type: "string" },
    },
  },
  returns: "node",
};

export function emitKeyed(params) {
  return async (state) => {
    const key = `${params.prefix ?? ""}${state[params.key_from]}`;
    return { [params.into]: { [key]: state[params.value_from] } };
  };
}
