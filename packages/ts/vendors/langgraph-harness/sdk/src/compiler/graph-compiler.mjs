/**
 * compiler/graph-compiler.mjs — stage 4 of the pipeline: normalized config +
 * registry → a compiled LangGraph StateGraph.
 *
 * Order of operations:
 *   1. resolve every edge's atom (edges may contribute hidden channels and
 *      synthetic guard nodes — loops do);
 *   2. build the Annotation.Root (declared + hidden channels);
 *   3. resolve every node's atom via the registry, validate its `with`
 *      params against the atom's meta.params schema, build the body, and
 *      add it wrapped in the wrap-node ritual;
 *   4. wire START → entry and let each edge atom wire itself;
 *   5. resolve the checkpointer atom; compile.
 *
 * The result carries the compiled graph, the topology JSON (for the CLI
 * `graph` command and the frontend viewer), the event hub, and the services.
 */

import { StateGraph, START, END } from "@langchain/langgraph";

import { ConfigValidationError, RegistryError } from "../errors.mjs";
import { validateSchema } from "../schema/mini-json-schema.mjs";
import { createEventHub } from "../events/events.mjs";
import { createLogger } from "../services/logger.mjs";
import { runArgv } from "../services/shell.mjs";
import { writeFileAtomic } from "../services/atomic-fs.mjs";
import { createLlmProvider } from "../llm/provider.mjs";
import { buildAnnotation } from "./state-factory.mjs";
import { wrapNode } from "./wrap-node.mjs";

const MAX_SUBGRAPH_DEPTH = 3;

/**
 * @param {object} config normalized flow config
 * @param {object} deps
 * @param {import("../registry/registry.mjs").Registry} deps.registry
 * @param {object} [deps.options] {mock, dryRun, baseDir, env, threadId, subgraphDepth, logger}
 * @param {(event: object) => void} [deps.onEvent]
 */
export async function compileFlow(config, { registry, options = {}, onEvent } = {}) {
  if (!registry) throw new RegistryError("compileFlow requires a registry");
  const depth = options.subgraphDepth ?? 0;
  if (depth > MAX_SUBGRAPH_DEPTH) {
    throw new ConfigValidationError([
      { path: "nodes", message: `subgraph nesting exceeds max depth ${MAX_SUBGRAPH_DEPTH}` },
    ]);
  }

  const hub = createEventHub({ onEvent });
  const logger = options.logger ?? createLogger({ context: { flow: config.name } });
  const mock = options.mock ?? config.runtime.mock ?? false;
  const dryRun = options.dryRun ?? config.runtime.dry_run ?? false;
  // The provider is INJECTABLE (`options.llm`): a caller that resolved its own
  // provider — e.g. the integration pack's SDK-backed adapter — passes it here,
  // so a new provider implementation never has to land inside this mirror.
  // Omitting `options.llm` keeps the historical behavior exactly.
  const llm = options.llm ?? createLlmProvider({ mock, model: options.model, env: options.env ?? process.env });
  if (llm.fallback_reason) logger.warn(llm.fallback_reason);

  const ctx = {
    flow: config,
    services: { logger, shell: { runArgv }, fs: { writeFileAtomic } },
    llm,
    registry,
    options: {
      mock,
      dryRun,
      baseDir: options.baseDir ?? config.meta?.dir ?? process.cwd(),
      env: options.env ?? process.env,
      threadId: options.threadId,
      subgraphDepth: depth,
    },
    stores: new Map(),
    emit: hub.emit,
  };

  // 1 — edge atoms first (they contribute hidden channels + synthetic nodes)
  const edgeAtoms = [];
  const hiddenChannels = {};
  const syntheticNodes = [];
  for (const edge of config.edges) {
    const patternName = edge.shape === "custom" ? edge.uses : `edges.${edge.shape}`;
    const binding = await registry.resolve(patternName);
    const spec = edge.shape === "custom" ? edge.with : edge;
    let atom;
    try {
      atom = await binding.factory(spec, ctx);
    } catch (err) {
      throw new ConfigValidationError([{ path: `edges[${edge.index}]`, message: err.message }], { cause: err });
    }
    edgeAtoms.push({ atom, edge });
    Object.assign(hiddenChannels, atom.channels ?? {});
    syntheticNodes.push(...(atom.syntheticNodes ?? []));
  }

  // 2 — state
  const channels = { ...config.state, ...hiddenChannels };
  const annotation = buildAnnotation(channels);
  const g = new StateGraph(annotation);

  // 3 — nodes (param-validated against each atom's meta.params)
  for (const [i, node] of config.nodes.entries()) {
    const binding = await registry.resolve(node.uses);
    if (binding.meta.params) {
      const issues = validateSchema(node.with, binding.meta.params, `nodes[${i}].with`);
      if (issues.length > 0) throw new ConfigValidationError(issues, { node: node.id, pattern: node.uses });
    }
    const nodeCtx = { ...ctx, node };
    let body;
    try {
      body = await binding.factory(node.with, nodeCtx);
    } catch (err) {
      throw new ConfigValidationError([{ path: `nodes[${i}].with`, message: `${node.uses}: ${err.message}` }], { cause: err });
    }
    if (typeof body !== "function") {
      throw new RegistryError(`pattern '${node.uses}' did not return a node body function`, { node: node.id });
    }
    g.addNode(node.id, wrapNode(node, body, nodeCtx));
  }

  // 4 — wiring
  const topology = [];
  const helpers = {
    START,
    END,
    mapTarget: (ref) => (ref === "END" ? END : ref),
    topology,
  };
  g.addEdge(START, config.entry);
  topology.push({ from: "START", to: config.entry, kind: "entry" });
  for (const { atom, edge } of edgeAtoms) {
    try {
      atom.wire(g, helpers);
    } catch (err) {
      throw new ConfigValidationError([{ path: `edges[${edge.index}]`, message: `wiring failed: ${err.message}` }], {
        cause: err,
      });
    }
  }

  // 5 — checkpointer atom + compile
  const cpBinding = await registry.resolve(config.runtime.checkpointer);
  const checkpointer = cpBinding.factory(config.runtime.checkpointer_params ?? {}, ctx);
  const graph = g.compile({ checkpointer: checkpointer ?? undefined });

  return {
    graph,
    config,
    checkpointer,
    hub,
    llm,
    ctx,
    topology: {
      entry: config.entry,
      checkpointer: config.runtime.checkpointer,
      nodes: [
        ...config.nodes.map((n) => ({ id: n.id, uses: n.uses, category: n.uses.split(".")[0], reads: n.reads, writes: n.writes })),
        ...syntheticNodes.map((n) => ({ ...n, category: "synthetic" })),
      ],
      edges: topology,
      channels: Object.fromEntries(
        Object.entries(channels).map(([name, decl]) => [name, { type: decl.type, reducer: decl.reducer ?? "last", injected: !!decl.injected }]),
      ),
    },
  };
}
