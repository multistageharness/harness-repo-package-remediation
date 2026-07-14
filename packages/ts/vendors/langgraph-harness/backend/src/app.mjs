/**
 * app.mjs — build the Fastify app over the langgraph-langchain-harness SDK (exported separately
 * from server.mjs so tests drive it via app.inject without binding a port).
 *
 * Surface:
 *   GET  /api/health                          liveness (never auth-gated)
 *   GET  /api/meta                            platform metadata
 *   GET  /api/patterns                        the mapped pattern registry
 *   GET  /api/flows                           flow catalog
 *   GET  /api/flows/:name                     raw + normalized config + validation
 *   GET  /api/flows/:name/graph               compiled topology json
 *   POST /api/flows/:name/runs                execute (body: {input, options, thread_id})
 *   GET  /api/flows/:name/runs/stream         SSE: live run events, then run.result
 *   POST /api/flows/:name/threads/:id/resume  resume an interrupted thread
 *   GET  /api/runs · GET /api/runs/:id        recent run registry
 *   GET  /*                                   built frontend (when dist exists)
 *
 * Enterprise posture: stable error envelope (LanggraphLangchainHarnessError code → HTTP status),
 * request-ids, optional bearer auth (LANGGRAPH_LANGCHAIN_HARNESS_API_TOKEN), event redaction
 * inherited from the SDK hub, graceful close.
 */

import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRegistry,
  loadFlowConfig,
  validateFlow,
  compileFlow,
  runFlow,
  resumeFlow,
  getThreadState,
  scanFlows,
  toErrorEnvelope,
  nullLogger,
  SDK_VERSION,
} from "@internal/langgraph-langchain-harness-sdk";

import { createRunStore } from "./run-store.mjs";
import { registerStatic } from "./static.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const langgraphLangchainHarnessRoot = resolve(here, "..", "..");

const STATUS_BY_CODE = {
  CONFIG_LOAD: 404,
  NOT_FOUND: 404,
  CONFIG_INVALID: 422,
  OUTPUT_INVALID: 422,
  MISSING_ENV: 422,
  MAPPING: 500,
  REGISTRY: 500,
  TRUST_BOUNDARY: 403,
  EXPR: 422,
  NODE_EXECUTION: 500,
  NO_CHECKPOINTER: 409,
  NO_THREAD: 409,
  INTERNAL: 500,
};

export async function buildApp(opts = {}) {
  const flowsDir = resolve(opts.flowsDir ?? process.env.LANGGRAPH_LANGCHAIN_HARNESS_FLOWS_DIR ?? join(langgraphLangchainHarnessRoot, "configs", "flows"));
  const mappingPath = resolve(opts.mapping ?? process.env.LANGGRAPH_LANGCHAIN_HARNESS_MAPPING ?? join(langgraphLangchainHarnessRoot, "configs", "mapping.yaml"));
  const apiToken = opts.apiToken ?? process.env.LANGGRAPH_LANGCHAIN_HARNESS_API_TOKEN ?? "";
  const distDir = opts.distDir ?? join(langgraphLangchainHarnessRoot, "frontend", "dist");

  const app = Fastify({
    logger: opts.logger ?? false,
    requestIdHeader: "x-request-id",
    genReqId: () => `req-${Math.random().toString(36).slice(2, 10)}`,
  });

  const registry = await createRegistry(mappingPath);
  const runStore = createRunStore({ keep: 100 });
  const startedAt = Date.now();

  // ── error envelope + request id ────────────────────────────────────────────
  app.setErrorHandler((err, request, reply) => {
    const envelope = toErrorEnvelope(err);
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : STATUS_BY_CODE[envelope.error.code] ?? 500;
    envelope.error.request_id = request.id;
    reply.code(status).send(envelope);
  });
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: "NOT_FOUND", message: `no route ${request.method} ${request.url}`, details: {}, request_id: request.id } });
  });
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  // ── optional bearer auth (health stays open) ──────────────────────────────
  if (apiToken) {
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.startsWith("/api/") || request.url === "/api/health") return;
      const auth = request.headers.authorization ?? "";
      if (auth !== `Bearer ${apiToken}`) {
        reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "missing or invalid bearer token", details: {}, request_id: request.id } });
      }
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  async function openFlowByName(name) {
    const flows = await scanFlows(flowsDir);
    const entry = flows.find((f) => f.name === name);
    if (!entry) {
      const err = new Error(`flow '${name}' not found`);
      err.statusCode = 404;
      throw err;
    }
    const { config, text } = await loadFlowConfig(entry.path);
    return { entry, config, text };
  }

  function compileOptions(body = {}) {
    return {
      mock: body.options?.mock ?? true,
      dryRun: body.options?.dry_run ?? false,
      logger: nullLogger(),
    };
  }

  // ── routes ─────────────────────────────────────────────────────────────────
  app.get("/api/health", async () => ({ status: "ok", uptime_s: Math.round((Date.now() - startedAt) / 1000), version: SDK_VERSION }));

  app.get("/api/meta", async () => {
    const flows = await scanFlows(flowsDir);
    return {
      version: SDK_VERSION,
      flows_dir: flowsDir,
      mapping: registry.mapping.layers,
      pattern_count: registry.names().length,
      flow_count: flows.length,
      auth: apiToken ? "bearer" : "none",
      pipeline: ["yaml", "mapping", "registry", "execute"],
    };
  });

  app.get("/api/patterns", async () => registry.describe());

  app.get("/api/flows", async () => scanFlows(flowsDir));

  app.get("/api/flows/:name", async (request) => {
    const { entry, config, text } = await openFlowByName(request.params.name);
    const validation = await validateFlow(config, { mapping: registry.mapping });
    return { ...entry, yaml: text, config, validation };
  });

  app.get("/api/flows/:name/graph", async (request) => {
    const { config } = await openFlowByName(request.params.name);
    const compiled = await compileFlow(config, { registry, options: { mock: true, logger: nullLogger() } });
    return compiled.topology;
  });

  app.post("/api/flows/:name/runs", async (request, reply) => {
    const body = request.body ?? {};
    const { config } = await openFlowByName(request.params.name);
    const validation = await validateFlow(config, { mapping: registry.mapping });
    if (!validation.ok) {
      return reply.code(422).send({ error: { code: "CONFIG_INVALID", message: "flow config is invalid", details: { issues: validation.issues }, request_id: request.id } });
    }
    const compiled = await compileFlow(config, { registry, options: compileOptions(body) });
    const record = runStore.create({ flow: config.name, options: body.options ?? {}, threadId: body.thread_id });
    try {
      const result = await runFlow(compiled, {
        input: body.input ?? {},
        threadId: body.thread_id,
        onEvent: (event) => record.events.push(event),
      });
      runStore.finish(record, result);
      return {
        run_id: record.id,
        status: result.status,
        thread_id: result.threadId,
        interrupt: result.interrupt ?? null,
        state: result.state,
        event_count: record.events.length,
      };
    } catch (err) {
      runStore.finish(record, { status: "failed", error: toErrorEnvelope(err).error });
      throw err;
    }
  });

  app.get("/api/flows/:name/runs/stream", async (request, reply) => {
    const { config } = await openFlowByName(request.params.name);
    let input = {};
    if (request.query.input) {
      try {
        input = JSON.parse(request.query.input);
      } catch {
        const err = new Error("query param 'input' must be JSON");
        err.statusCode = 400;
        throw err;
      }
    }
    const options = { options: { mock: request.query.mock !== "false", dry_run: request.query.dry_run === "true" } };
    const compiled = await compileFlow(config, { registry, options: compileOptions(options) });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-request-id": request.id,
      "access-control-allow-origin": "*",
    });
    reply.hijack();
    const send = (event, data) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const record = runStore.create({ flow: config.name, options: options.options, threadId: request.query.thread_id });
    try {
      const result = await runFlow(compiled, {
        input,
        threadId: request.query.thread_id,
        onEvent: (event) => {
          record.events.push(event);
          send("run.event", event);
        },
      });
      runStore.finish(record, result);
      send("run.result", {
        run_id: record.id,
        status: result.status,
        thread_id: result.threadId,
        interrupt: result.interrupt ?? null,
        state: result.state,
      });
    } catch (err) {
      runStore.finish(record, { status: "failed", error: toErrorEnvelope(err).error });
      send("run.error", toErrorEnvelope(err).error);
    } finally {
      reply.raw.end();
    }
  });

  app.post("/api/flows/:name/threads/:threadId/resume", async (request, reply) => {
    const body = request.body ?? {};
    const { config } = await openFlowByName(request.params.name);
    const compiled = await compileFlow(config, { registry, options: compileOptions(body) });
    const pending = await getThreadState(compiled, request.params.threadId);
    if (pending.pendingInterrupt === undefined && pending.next.length === 0) {
      return reply.code(409).send({
        error: { code: "NO_THREAD", message: `nothing to resume on thread '${request.params.threadId}'`, details: {}, request_id: request.id },
      });
    }
    const record = runStore.create({ flow: config.name, options: body.options ?? {}, threadId: request.params.threadId });
    const result = await resumeFlow(compiled, {
      threadId: request.params.threadId,
      resume: body.resume ?? { approve: true },
      onEvent: (event) => record.events.push(event),
    });
    runStore.finish(record, result);
    return {
      run_id: record.id,
      status: result.status,
      thread_id: result.threadId,
      interrupt: result.interrupt ?? null,
      state: result.state,
      event_count: record.events.length,
    };
  });

  app.get("/api/flows/:name/threads/:threadId", async (request) => {
    const { config } = await openFlowByName(request.params.name);
    const compiled = await compileFlow(config, { registry, options: { mock: true, logger: nullLogger() } });
    return getThreadState(compiled, request.params.threadId);
  });

  app.get("/api/runs", async () => runStore.list());

  app.get("/api/runs/:id", async (request, reply) => {
    const record = runStore.get(request.params.id);
    if (!record) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: `run '${request.params.id}' not found`, details: {}, request_id: request.id } });
    }
    return record;
  });

  // ── frontend hosting (only when built) ─────────────────────────────────────
  const staticMounted = await registerStatic(app, distDir);
  if (!staticMounted) {
    app.get("/", async () => ({
      service: "langgraph-langchain-harness backend",
      version: SDK_VERSION,
      note: "frontend dist not built — run `npm run build -w frontend`; api under /api/*",
    }));
  }

  return app;
}
