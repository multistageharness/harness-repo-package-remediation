/**
 * compiler/wrap-node.mjs — the node boundary ritual. EVERY node body (from
 * any atom) is composed inside this wrapper, so the platform's guarantees
 * hold no matter what the atom does:
 *
 *   1. input gate     — declared `reads` channels must be present
 *   2. retry loop     — node.retry {max, delay_ms} for transient failures
 *   3. write filter   — a node physically cannot write channels it did not
 *                       declare (plus the always-allowed diagnostics)
 *   4. validate gate  — declared output schema; on_invalid raise | degrade
 *   5. error policy   — on_error raise | continue (continue → diagnostics)
 *   6. last_step      — every delta stamps the diagnostics cursor
 *
 * LangGraph control-flow exceptions (interrupt/Command bubbles) pass through
 * untouched — they are the HITL mechanism, not errors.
 */

import { NodeExecutionError, OutputValidationError } from "../errors.mjs";
import { validateSchema } from "../schema/mini-json-schema.mjs";

const ALWAYS_WRITABLE = new Set(["error_logs", "last_step"]);

/** LangGraph flow-control exceptions that must never be swallowed. */
function isControlFlow(err) {
  const name = err?.constructor?.name ?? err?.name ?? "";
  return /Interrupt|BubbleUp|ParentCommand|Command/.test(name);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} node normalized node config
 * @param {(state: object, cfg: object) => Promise<object>} body atom-produced node body
 * @param {object} ctx build context ({flow, emit, services, ...})
 */
export function wrapNode(node, body, ctx) {
  const allowed = new Set([...(node.writes ?? []), ...ALWAYS_WRITABLE]);
  const filterWrites = (node.writes ?? []).length > 0;

  return async (state, cfg) => {
    const startedAt = Date.now();
    ctx.emit("node.start", { node: node.id, uses: node.uses });

    // 1 — input gate
    for (const channel of node.reads ?? []) {
      if (state[channel] === undefined) {
        throw new NodeExecutionError(node.id, `input gate: required channel '${channel}' is undefined`, { channel });
      }
    }

    // 2 — body with bounded retry
    const maxAttempts = node.retry?.max ?? 1;
    let delta;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        delta = (await body(state, cfg)) ?? {};
        lastError = null;
        break;
      } catch (err) {
        if (isControlFlow(err)) throw err; // HITL / Send bubbles pass through
        lastError = err;
        if (attempt < maxAttempts) {
          ctx.emit("node.retry", { node: node.id, attempt, of: maxAttempts, error: err.message });
          if (node.retry?.delay_ms) await sleep(node.retry.delay_ms);
        }
      }
    }

    // 5 — error policy
    if (lastError != null) {
      ctx.emit("node.error", { node: node.id, error: lastError.message, policy: node.on_error });
      if (node.on_error === "continue") {
        return {
          error_logs: [`[${node.id}] ${lastError.message}`],
          last_step: `${node.id}:error`,
        };
      }
      throw lastError instanceof NodeExecutionError
        ? lastError
        : new NodeExecutionError(node.id, lastError.message, { cause: lastError.stack });
    }

    if (typeof delta !== "object" || Array.isArray(delta)) {
      throw new NodeExecutionError(node.id, `node body returned ${Array.isArray(delta) ? "an array" : typeof delta} — deltas must be plain objects`);
    }

    // 3 — write filter
    let filtered = delta;
    if (filterWrites) {
      filtered = {};
      const droppedKeys = [];
      for (const [key, value] of Object.entries(delta)) {
        if (allowed.has(key)) filtered[key] = value;
        else droppedKeys.push(key);
      }
      if (droppedKeys.length > 0) {
        ctx.emit("node.error", {
          node: node.id,
          error: `write filter dropped undeclared channel(s): ${droppedKeys.join(", ")}`,
          policy: "filter",
        });
      }
    }

    // 4 — validate gate
    if (node.validate?.schema != null) {
      const schema =
        typeof node.validate.schema === "string" ? ctx.flow.types?.[node.validate.schema] : node.validate.schema;
      const outChannel = typeof node.with?.out === "string" ? node.with.out : null;
      const target = outChannel != null && outChannel in filtered ? filtered[outChannel] : filtered;
      const issues = validateSchema(target, schema, outChannel ?? "$");
      if (issues.length > 0) {
        if (node.validate.on_invalid === "degrade") {
          ctx.emit("node.error", { node: node.id, error: `output failed validation (degraded): ${issues[0].path}: ${issues[0].message}`, policy: "degrade" });
          if (outChannel != null) {
            if (node.validate.fallback !== undefined) filtered[outChannel] = node.validate.fallback;
            else delete filtered[outChannel];
          }
          filtered.error_logs = [
            ...(filtered.error_logs ?? []),
            `[${node.id}] output degraded: ${issues[0].path}: ${issues[0].message}`,
          ];
        } else {
          throw new OutputValidationError(node.id, issues);
        }
      }
    }

    // 6 — diagnostics cursor
    filtered.last_step = filtered.last_step ?? node.id;

    ctx.emit("node.end", {
      node: node.id,
      ms: Date.now() - startedAt,
      wrote: Object.keys(filtered).filter((k) => !ALWAYS_WRITABLE.has(k)),
    });
    return filtered;
  };
}
