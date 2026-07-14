/**
 * commands.ingestUnknownSource — CUSTOM pattern (project-local; change record
 * 0021/D1): the ingest sub-langgraph's `default` lane. It exists to FAIL LOUDLY.
 *
 * `nodes.router` requires a `default` token, and `edges.switch` warns when a
 * switch has no `default` target. Routing an unrecognized `ingest_source` to a
 * silent no-op would emit `rows: []` — a green run with an empty dataset, zero
 * clones, and zero remediations, indistinguishable from "this repo set is
 * clean". 0021/D1 forbids that: "an unknown ingest source must not yield an
 * empty dataset that looks like a clean run."
 *
 * So the default lane throws. The node's default `on_error: raise` turns that
 * into a `run.error`, the wizard's progress renderer prints `✗ run error: …`,
 * and the run exits non-zero. The six legal tokens are named in the message so
 * the failure is self-explaining.
 *
 * Pure + deterministic: no fs, no network, no seam, no shell. Throws under mock
 * exactly as it throws for real — an unknown source is a config bug, not an
 * environment condition.
 */

import { INGEST_SOURCES } from "../../src/ingest-lanes.mjs";

export const meta = {
  name: "commands.ingestUnknownSource",
  category: "commands",
  summary: "Loud-failure lane for an unrecognized ingest_source token (never yields an empty-but-green run).",
  params: {
    type: "object",
    required: ["source_from"],
    properties: {
      source_from: { type: "string", minLength: 1 },
      allowed: { type: "array", items: { type: "string" } },
    },
  },
  returns: "node",
};

export function ingestUnknownSource(params) {
  return async (state) => {
    const token = state[params.source_from];
    const allowed = params.allowed ?? INGEST_SOURCES;
    throw new Error(
      `commands.ingestUnknownSource: unrecognized ingest source '${token ?? ""}' — expected one of ${allowed.join(" | ")}. ` +
        `Refusing to ingest zero rows, which would look like a clean run.`,
    );
  };
}
