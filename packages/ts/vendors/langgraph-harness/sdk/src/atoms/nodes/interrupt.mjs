/**
 * nodes.interrupt — human-in-the-loop pause. Calls LangGraph's interrupt()
 * with a question payload; execution freezes (checkpointer required) until
 * the runner resumes with `Command({resume: value})`, which lands in `into`.
 */

import { interrupt } from "@langchain/langgraph";

export const meta = {
  name: "nodes.interrupt",
  category: "nodes",
  summary: "HITL pause: interrupt({message, payload}); resume value → into channel.",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      message: { type: "string" },
      payload_channels: { type: "array", items: { type: "string" } },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function interruptNode(params, ctx) {
  return async (state) => {
    const payload = {};
    for (const channel of params.payload_channels ?? []) payload[channel] = state[channel];
    const resumeValue = interrupt({
      message: params.message ?? "input required",
      node: ctx.node?.id,
      payload,
    });
    return { [params.into]: resumeValue };
  };
}
