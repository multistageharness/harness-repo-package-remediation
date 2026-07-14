/**
 * @internal/langgraph-langchain-harness-sdk — the enterprise config-driven LangChain + LangGraph platform.
 *
 * The pipeline:  yaml → mapping → registry → execute
 *
 *   loadFlowConfig()   parse + interpolate + normalize the flow yaml
 *   loadMapping()      pattern name → module reference (default + overlays)
 *   createRegistry()   dynamic-import + verify atom factories on demand
 *   validateFlow()     meta-schema + structural invariants (precise paths)
 *   compileFlow()      registry-resolved atoms → a compiled StateGraph
 *   runFlow()          invoke with the run-event envelope
 *   resumeFlow()       Command({resume}) into an interrupted thread
 *
 * openFlow() is the one-call facade the CLI/backend build on.
 */

export * from "./errors.mjs";
export { loadFlowConfig, parseFlowConfig, scanFlows, interpolateEnv, coerceScalar, detectEdgeShape } from "./loader/config-loader.mjs";
export { validateFlow } from "./loader/validate.mjs";
export { loadMapping, Mapping, DEFAULT_MAPPING_PATH } from "./mapping/mapping-loader.mjs";
export { Registry, createRegistry } from "./registry/registry.mjs";
export { compileFlow } from "./compiler/graph-compiler.mjs";
export { buildAnnotation } from "./compiler/state-factory.mjs";
export { wrapNode } from "./compiler/wrap-node.mjs";
export { runFlow, resumeFlow, getThreadState } from "./executor/executor.mjs";
export { createLlmProvider, fnv1a, LLM_PROVIDERS, PACK_RESOLVED_PROVIDERS } from "./llm/provider.mjs";
// The one llm-seam helper (emit → invoke → emit). Exported so a config pack's
// own skills atoms reach the seam through the SAME helper the built-in skills
// atoms use, instead of hand-rolling the event pair.
export { callLlm } from "./atoms/skills/_skill-base.mjs";
export { createEventHub, EVENT_TYPES } from "./events/events.mjs";
export { renderTemplate, extractTemplateVars } from "./template/engine.mjs";
export { parseExpr, compilePredicate, extractChannels } from "./expr/expr.mjs";
export { validateSchema, matchesSchema, skeletonFromSchema } from "./schema/mini-json-schema.mjs";
export { metaSchema } from "./schema/meta-schema.mjs";
export { createLogger, nullLogger } from "./services/logger.mjs";
export { redactValue, redactString } from "./services/redactor.mjs";
export { runArgv } from "./services/shell.mjs";
export { writeFileAtomic } from "./services/atomic-fs.mjs";

import { loadFlowConfig } from "./loader/config-loader.mjs";
import { validateFlow } from "./loader/validate.mjs";
import { createRegistry } from "./registry/registry.mjs";
import { compileFlow } from "./compiler/graph-compiler.mjs";
import { ConfigValidationError } from "./errors.mjs";

/**
 * The one-call facade: yaml file → validated, compiled, runnable flow.
 *
 * @param {string} flowPath path to the flow yaml
 * @param {object} [opts]
 * @param {string|null} [opts.mappingPath] project mapping yaml (default: SDK built-ins)
 * @param {import("./registry/registry.mjs").Registry} [opts.registry] reuse a registry
 * @param {object} [opts.options] compile options {mock, dryRun, env, threadId, logger}
 * @param {(event: object) => void} [opts.onEvent]
 * @returns {Promise<{compiled: object, config: object, validation: object, registry: object}>}
 */
export async function openFlow(flowPath, opts = {}) {
  const registry = opts.registry ?? (await createRegistry(opts.mappingPath ?? null));
  const { config } = await loadFlowConfig(flowPath, { env: opts.options?.env });
  const validation = await validateFlow(config, { mapping: registry.mapping });
  if (!validation.ok) throw new ConfigValidationError(validation.issues, { flow: flowPath });
  const compiled = await compileFlow(config, { registry, options: opts.options ?? {}, onEvent: opts.onEvent });
  return { compiled, config, validation, registry };
}

export const SDK_VERSION = "100.0.0";
