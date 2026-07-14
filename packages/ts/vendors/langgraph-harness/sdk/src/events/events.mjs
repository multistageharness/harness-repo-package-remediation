/**
 * events/events.mjs — typed run-event stream (atomic service).
 *
 * The executor emits these; the CLI renders them verbose, the backend
 * forwards them over SSE, and the frontend paints them live. One event
 * vocabulary across all three surfaces.
 *
 * Types:
 *   run.start | run.end | run.error | run.interrupted | run.resumed
 *   node.start | node.end | node.error | node.retry
 *   llm.call | llm.result
 *   edge.route | loop.guard | fanout.dispatch
 *   checkpoint.save
 */

import { redactValue } from "../services/redactor.mjs";

export const EVENT_TYPES = [
  "run.start",
  "run.end",
  "run.error",
  "run.interrupted",
  "run.resumed",
  "node.start",
  "node.end",
  "node.error",
  "node.retry",
  "llm.call",
  "llm.result",
  "edge.route",
  "loop.guard",
  "fanout.dispatch",
  "checkpoint.save",
];

const KNOWN = new Set(EVENT_TYPES);

/**
 * Create a run-scoped event hub.
 * @param {{onEvent?: (event: object) => void, keep?: number}} [opts]
 */
export function createEventHub({ onEvent, keep = 1000 } = {}) {
  let seq = 0;
  const buffer = [];
  const listeners = new Set();
  if (onEvent) listeners.add(onEvent);

  function emit(type, payload = {}) {
    if (!KNOWN.has(type)) throw new TypeError(`unknown event type '${type}'`);
    const event = { seq: ++seq, ts: new Date().toISOString(), type, ...redactValue(payload) };
    buffer.push(event);
    if (buffer.length > keep) buffer.shift();
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        // a broken listener must never break the run
      }
    }
    return event;
  }

  return {
    emit,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    list() {
      return [...buffer];
    },
  };
}
