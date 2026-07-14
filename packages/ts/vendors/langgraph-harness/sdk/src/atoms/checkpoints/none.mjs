/**
 * checkpoints.none — no checkpointing. The default for pure pipelines
 * (interrupt-free flows) across the corpus.
 */

export const meta = {
  name: "checkpoints.none",
  category: "checkpoints",
  summary: "No checkpointer — pure pipeline, no thread state.",
  params: { type: "object", properties: {} },
  returns: "checkpointer",
};

/** @returns {null} */
export function none() {
  return null;
}
