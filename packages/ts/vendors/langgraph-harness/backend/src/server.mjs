/**
 * server.mjs — production bootstrap: build the app, bind, drain on signal.
 *
 *   PORT (default 7100) · HOST (default 127.0.0.1)
 *   LANGGRAPH_LANGCHAIN_HARNESS_FLOWS_DIR / LANGGRAPH_LANGCHAIN_HARNESS_MAPPING / LANGGRAPH_LANGCHAIN_HARNESS_API_TOKEN / LANGGRAPH_LANGCHAIN_HARNESS_LOG_FORMAT
 */

import { buildApp } from "./app.mjs";
import { createLogger } from "@internal/langgraph-langchain-harness-sdk";

const logger = createLogger({ context: { service: "langgraph-langchain-harness-backend" } });
const port = Number(process.env.PORT ?? 7100);
const host = process.env.HOST ?? "127.0.0.1";

const app = await buildApp();

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info("shutting down", { signal });
  await app.close().catch((err) => logger.error("close failed", { error: err.message }));
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  await app.listen({ port, host });
  logger.info("langgraph-langchain-harness backend listening", { url: `http://${host}:${port}`, api: `http://${host}:${port}/api/health` });
} catch (err) {
  logger.error("listen failed", { error: err.message, port, host });
  process.exit(1);
}
