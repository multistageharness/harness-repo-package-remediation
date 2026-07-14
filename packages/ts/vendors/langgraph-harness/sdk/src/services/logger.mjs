/**
 * services/logger.mjs — structured logger (atomic service).
 *
 * JSON-lines when `LANGGRAPH_LANGCHAIN_HARNESS_LOG_FORMAT=json` (the enterprise/aggregator mode),
 * human `[level] msg key=value` lines otherwise. Child loggers carry bound
 * context (run_id, node_id, ...). All langgraph-langchain-harness packages log through this seam so
 * redaction is applied in exactly one place.
 */

import { redactValue } from "./redactor.mjs";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export function createLogger({ level = process.env.LANGGRAPH_LANGCHAIN_HARNESS_LOG_LEVEL ?? "info", format = process.env.LANGGRAPH_LANGCHAIN_HARNESS_LOG_FORMAT ?? "pretty", stream = process.stderr, context = {} } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(lvl, msg, fields = {}) {
    if ((LEVELS[lvl] ?? 0) < threshold) return;
    const record = { ...context, ...fields };
    const safe = redactValue(record);
    if (format === "json") {
      stream.write(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...safe }) + "\n");
    } else {
      const kv = Object.entries(safe)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ");
      stream.write(`[${lvl}] ${msg}${kv ? " " + kv : ""}\n`);
    }
  }

  return {
    level,
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    child(extra) {
      return createLogger({ level, format, stream, context: { ...context, ...extra } });
    },
  };
}

/** A logger that swallows everything — used by tests and `--quiet`. */
export function nullLogger() {
  return createLogger({ level: "silent" });
}
