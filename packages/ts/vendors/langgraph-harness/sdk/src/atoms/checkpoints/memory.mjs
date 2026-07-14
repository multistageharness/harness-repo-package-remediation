/**
 * checkpoints.memory — LangGraph's in-process MemorySaver. Required for
 * interrupt/resume within one process lifetime; state is lost on restart.
 */

import { MemorySaver } from "@langchain/langgraph";

export const meta = {
  name: "checkpoints.memory",
  category: "checkpoints",
  summary: "In-process MemorySaver — enables interrupt/resume for the process lifetime.",
  params: { type: "object", properties: {} },
  returns: "checkpointer",
};

/** @returns {import("@langchain/langgraph").MemorySaver} */
export function memory() {
  return new MemorySaver();
}
