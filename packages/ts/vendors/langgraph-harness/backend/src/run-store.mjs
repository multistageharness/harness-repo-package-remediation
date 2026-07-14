/**
 * run-store.mjs — in-memory registry of recent runs (id → record). Powers
 * GET /api/runs and the frontend's run history panel. Bounded ring (last
 * `keep` runs); durable thread state itself lives in the checkpointer, not
 * here.
 */

import { randomUUID } from "node:crypto";

export function createRunStore({ keep = 100 } = {}) {
  const runs = new Map();

  function trim() {
    while (runs.size > keep) {
      const oldest = runs.keys().next().value;
      runs.delete(oldest);
    }
  }

  return {
    create({ flow, options, threadId }) {
      const record = {
        id: `run-${randomUUID()}`,
        flow,
        options,
        thread_id: threadId ?? null,
        status: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        events: [],
        state: null,
        interrupt: null,
        error: null,
      };
      runs.set(record.id, record);
      trim();
      return record;
    },
    finish(record, { status, state, interrupt, threadId, error }) {
      record.status = status;
      record.state = state ?? null;
      record.interrupt = interrupt ?? null;
      record.thread_id = threadId ?? record.thread_id;
      record.error = error ?? null;
      record.finished_at = new Date().toISOString();
      return record;
    },
    get(id) {
      return runs.get(id) ?? null;
    },
    list() {
      return [...runs.values()]
        .map(({ events, state, ...summary }) => ({ ...summary, event_count: events.length }))
        .reverse();
    },
  };
}
