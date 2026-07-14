/**
 * compiler/state-factory.mjs — the `state:` block → a LangGraph
 * Annotation.Root. Four reducers (the corpus-complete set):
 *
 *   last    last-write-wins (the default)
 *   concat  list append — error_logs / findings accumulation
 *   merge   object spread — Send fan-out joins (operator.or_ lineage)
 *   add     numeric sum — hidden loop counters
 */

import { Annotation } from "@langchain/langgraph";

const TYPE_DEFAULTS = {
  string: "",
  number: 0,
  boolean: false,
  object: {},
  array: [],
};

function defaultFor(decl) {
  const base = decl.default !== undefined ? decl.default : TYPE_DEFAULTS[decl.type];
  // fresh copies for mutables so parallel branches never share references
  if (Array.isArray(base)) return () => structuredClone(base);
  if (base !== null && typeof base === "object") return () => structuredClone(base);
  return () => base;
}

const REDUCER_FNS = {
  last: (_left, right) => right,
  concat: (left, right) => (left ?? []).concat(Array.isArray(right) ? right : [right]),
  merge: (left, right) => ({ ...(left ?? {}), ...(right ?? {}) }),
  add: (left, right) => (left ?? 0) + (right ?? 0),
};

/**
 * Build the Annotation.Root for a channel map
 * (`{name: {type, default, reducer}}`, hidden channels included).
 */
export function buildAnnotation(channels) {
  const spec = {};
  for (const [name, decl] of Object.entries(channels)) {
    const reducer = REDUCER_FNS[decl.reducer ?? "last"];
    if (!reducer) throw new TypeError(`state.${name}: unknown reducer '${decl.reducer}'`);
    spec[name] = Annotation({ reducer, default: defaultFor(decl) });
  }
  return Annotation.Root(spec);
}

export const KNOWN_REDUCERS = Object.keys(REDUCER_FNS);
