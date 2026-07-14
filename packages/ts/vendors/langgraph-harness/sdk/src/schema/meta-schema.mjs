/**
 * schema/meta-schema.mjs — the config-time gate over a NORMALIZED flow config.
 *
 * Expressed in the mini-json-schema subset (schema/mini-json-schema.mjs).
 * Structural rules JSON-Schema cannot express (edge refs resolve, loops are
 * bounded, channels exist, ...) live in loader/validate.mjs as invariants.
 */

const IDENT = "^[A-Za-z_][A-Za-z0-9_]*$";
const PATTERN_NAME = "^[a-z][a-zA-Z0-9]*\\.[a-zA-Z][a-zA-Z0-9_]*$";

export const edgeSchemas = {
  linear: {
    type: "object",
    required: ["from", "to"],
    properties: { shape: true, index: true, from: { type: "string" }, to: { type: "string" } },
  },
  conditional: {
    type: "object",
    required: ["from", "when", "to"],
    properties: {
      shape: true,
      index: true,
      from: { type: "string" },
      when: { type: "string", minLength: 1 },
      to: { type: "string" },
      else: { type: "string" },
    },
  },
  switch: {
    type: "object",
    required: ["from", "on", "cases"],
    properties: {
      shape: true,
      index: true,
      from: { type: "string" },
      on: { type: "string", pattern: IDENT },
      cases: { type: "object" },
      default: { type: "string" },
    },
  },
  loop: {
    type: "object",
    required: ["from", "body_from", "max", "on_max"],
    properties: {
      shape: true,
      index: true,
      from: { type: "string" },
      body_from: { type: "string" },
      until: { type: "string" },
      max: { type: "integer", minimum: 1, maximum: 1000 },
      on_max: { type: "string" },
    },
  },
  fanout: {
    type: "object",
    required: ["from", "over", "to", "then"],
    properties: {
      shape: true,
      index: true,
      from: { type: "string" },
      over: { type: "string", pattern: IDENT },
      to: { type: "string" },
      carry: { type: "array", items: { type: "string", pattern: IDENT } },
      then: { type: "string" },
    },
  },
  custom: {
    type: "object",
    required: ["uses"],
    properties: { shape: true, index: true, uses: { type: "string", pattern: PATTERN_NAME }, with: { type: "object" } },
  },
};

export const metaSchema = {
  type: "object",
  required: ["version", "name", "state", "entry", "nodes", "edges"],
  properties: {
    version: { type: "integer", minimum: 1 },
    name: { type: "string", pattern: "^[a-z][a-z0-9-]*$", minLength: 1, maxLength: 100 },
    description: { type: "string" },
    runtime: {
      type: "object",
      properties: {
        recursion_limit: { type: "integer", minimum: 1, maximum: 10000 },
        checkpointer: { type: "string" },
        checkpointer_params: { type: "object" },
        mock: { type: "boolean" },
        dry_run: { type: "boolean" },
      },
    },
    env: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
          required: { type: "boolean" },
          default: true,
        },
      },
    },
    types: { type: "object" },
    state: {
      type: "object",
    },
    entry: { type: "string", minLength: 1 },
    nodes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "uses"],
        properties: {
          id: { type: "string", pattern: IDENT },
          uses: { type: "string", pattern: PATTERN_NAME },
          with: { type: "object" },
          reads: { type: "array", items: { type: "string", pattern: IDENT } },
          writes: { type: "array", items: { type: "string", pattern: IDENT } },
          on_error: { enum: ["raise", "continue"] },
          validate: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  schema: true,
                  on_invalid: { enum: ["raise", "degrade"] },
                  fallback: true,
                },
              },
            ],
          },
          retry: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  max: { type: "integer", minimum: 1, maximum: 20 },
                  delay_ms: { type: "integer", minimum: 0, maximum: 60000 },
                },
              },
            ],
          },
        },
      },
    },
    edges: { type: "array", minItems: 1 },
    meta: true,
  },
};

export const channelSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: { enum: ["string", "number", "boolean", "object", "array"] },
    default: true,
    reducer: { enum: ["last", "concat", "merge", "add"] },
    injected: true,
  },
};
