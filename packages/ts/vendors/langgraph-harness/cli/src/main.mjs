#!/usr/bin/env node
/**
 * @internal/langgraph-langchain-harness-cli — the terminal surface over the langgraph-langchain-harness SDK.
 *
 *   langgraph-langchain-harness list                                   flows in the flows dir
 *   langgraph-langchain-harness patterns [--verify]                    the mapped pattern registry
 *   langgraph-langchain-harness validate <flow>                        config-time gate (exit 2 on issues)
 *   langgraph-langchain-harness graph <flow> [--format json|ascii]     compiled topology
 *   langgraph-langchain-harness run <flow> [--input k=v ...] [--no-mock] [--dry-run] [--thread t] [--events] [--json]
 *   langgraph-langchain-harness resume <flow> --thread <id> [--resume-json '{...}'] [--json]
 *
 * Flow argument: a name from the flows dir or a yaml path. Exit codes:
 * 0 ok · 1 runtime failure · 2 config/validation error · 3 usage error.
 */

import { access } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";

import {
  createRegistry,
  loadFlowConfig,
  validateFlow,
  compileFlow,
  runFlow,
  resumeFlow,
  getThreadState,
  scanFlows,
  coerceScalar,
  toErrorEnvelope,
  nullLogger,
} from "@internal/langgraph-langchain-harness-sdk";

// ── argv parsing (house style: hand-rolled, no deps) ─────────────────────────

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const flags = { input: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--input") flags.input.push(rest[++i]);
    else if (arg === "--thread") flags.thread = rest[++i];
    else if (arg === "--resume-json") flags.resumeJson = rest[++i];
    else if (arg === "--format") flags.format = rest[++i];
    else if (arg === "--flows-dir") flags.flowsDir = rest[++i];
    else if (arg === "--mapping") flags.mapping = rest[++i];
    else if (arg === "--mock") flags.mock = true;
    else if (arg === "--no-mock") flags.mock = false;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--events") flags.events = true;
    else if (arg === "--verify") flags.verify = true;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--quiet") flags.quiet = true;
    else if (arg.startsWith("--")) usageError(`unknown flag '${arg}'`);
    else positional.push(arg);
  }
  return { command, positional, flags };
}

function usageError(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}\n`);
  process.exit(3);
}

const USAGE = `usage:
  langgraph-langchain-harness list
  langgraph-langchain-harness patterns [--verify] [--json]
  langgraph-langchain-harness validate <flow> [--json]
  langgraph-langchain-harness graph <flow> [--format json|ascii]
  langgraph-langchain-harness run <flow> [--input k=v ...] [--no-mock] [--dry-run] [--thread t] [--events] [--json]
  langgraph-langchain-harness resume <flow> --thread <id> [--resume-json '{"approve":true}'] [--json]

flow: a name from the flows dir (configs/flows) or a path to a yaml file.
common flags: --flows-dir <dir> --mapping <file>   (env: LANGGRAPH_LANGCHAIN_HARNESS_FLOWS_DIR / LANGGRAPH_LANGCHAIN_HARNESS_MAPPING)`;

// ── environment resolution ───────────────────────────────────────────────────

function resolvePaths(flags) {
  const flowsDir = resolve(flags.flowsDir ?? process.env.LANGGRAPH_LANGCHAIN_HARNESS_FLOWS_DIR ?? join("configs", "flows"));
  const mapping = resolve(flags.mapping ?? process.env.LANGGRAPH_LANGCHAIN_HARNESS_MAPPING ?? join("configs", "mapping.yaml"));
  return { flowsDir, mapping };
}

async function resolveFlowPath(flowArg, flowsDir) {
  if (/[\\/]|\.ya?ml$|\.json$/.test(flowArg)) {
    const path = isAbsolute(flowArg) ? flowArg : resolve(flowArg);
    await access(path).catch(() => usageError(`flow file not found: ${flowArg}`));
    return path;
  }
  for (const candidate of [`${flowArg}.yaml`, `${flowArg}.yml`, `${flowArg}.json`]) {
    const path = join(flowsDir, candidate);
    if (await access(path).then(() => true, () => false)) return path;
  }
  usageError(`flow '${flowArg}' not found in ${flowsDir} (try 'langgraph-langchain-harness list')`);
}

function parseInputs(pairs) {
  const input = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) usageError(`--input expects k=v (got '${pair}')`);
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    try {
      input[key] = raw.startsWith("{") || raw.startsWith("[") ? JSON.parse(raw) : coerceScalar(raw);
    } catch {
      input[key] = raw;
    }
  }
  return input;
}

const print = (text) => process.stdout.write(text + "\n");

function printEvent(event) {
  const detail = Object.entries(event)
    .filter(([k]) => !["seq", "ts", "type"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  process.stderr.write(`  [${String(event.seq).padStart(3)}] ${event.type} ${detail}\n`);
}

// ── commands ─────────────────────────────────────────────────────────────────

async function cmdList({ flags }) {
  const { flowsDir } = resolvePaths(flags);
  const flows = await scanFlows(flowsDir);
  if (flags.json) return print(JSON.stringify(flows, null, 2));
  print(`flows in ${flowsDir}:`);
  for (const flow of flows) {
    print(`  ${flow.name.padEnd(24)} ${String(flow.nodes).padStart(2)} nodes  ${String(flow.edges).padStart(2)} edges  ${flow.description}`);
  }
}

async function cmdPatterns({ flags }) {
  const { mapping } = resolvePaths(flags);
  const registry = await createRegistry(mapping);
  if (flags.verify) {
    const results = await registry.verifyAll();
    const failed = results.filter((r) => !r.ok);
    if (flags.json) return print(JSON.stringify({ total: results.length, failed }, null, 2));
    for (const r of results) print(`${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(28)} ${r.ok ? r.module : r.error}`);
    print(`\n${results.length - failed.length}/${results.length} patterns verified`);
    if (failed.length > 0) process.exit(1);
    return;
  }
  const byCategory = await registry.describe();
  if (flags.json) return print(JSON.stringify(byCategory, null, 2));
  for (const [category, entries] of Object.entries(byCategory)) {
    print(`${category} (${entries.length})`);
    for (const entry of entries) print(`  ${entry.name.padEnd(28)} ${entry.summary}`);
  }
}

async function cmdValidate({ positional, flags }) {
  const [flowArg] = positional;
  if (!flowArg) usageError("validate requires a <flow>");
  const { flowsDir, mapping } = resolvePaths(flags);
  const registry = await createRegistry(mapping);
  const path = await resolveFlowPath(flowArg, flowsDir);
  const { config } = await loadFlowConfig(path);
  const result = await validateFlow(config, { mapping: registry.mapping });
  if (flags.json) return print(JSON.stringify({ flow: config.name, ...result }, null, 2));
  if (result.ok) {
    print(`ok: ${config.name} — ${config.nodes.length} nodes, ${config.edges.length} edges, checkpointer ${config.runtime.checkpointer}`);
    for (const warning of result.warnings) print(`  warn ${warning.path}: ${warning.message}`);
  } else {
    print(`INVALID: ${config.name}`);
    for (const issue of result.issues) print(`  ${issue.path}: ${issue.message}`);
    process.exit(2);
  }
}

async function cmdGraph({ positional, flags }) {
  const [flowArg] = positional;
  if (!flowArg) usageError("graph requires a <flow>");
  const { flowsDir, mapping } = resolvePaths(flags);
  const registry = await createRegistry(mapping);
  const path = await resolveFlowPath(flowArg, flowsDir);
  const { config } = await loadFlowConfig(path);
  const compiled = await compileFlow(config, { registry, options: { mock: true, logger: nullLogger() } });
  const topo = compiled.topology;
  if ((flags.format ?? "ascii") === "json") return print(JSON.stringify(topo, null, 2));
  print(`${config.name} — entry: ${topo.entry}, checkpointer: ${topo.checkpointer}`);
  print("nodes:");
  for (const node of topo.nodes) print(`  ${node.synthetic ? "· " : "● "}${node.id.padEnd(26)} ${node.uses}`);
  print("edges:");
  for (const edge of topo.edges) {
    const label = edge.label ? `  [${edge.label}]` : "";
    print(`  ${edge.from} → ${edge.to}${label} (${edge.kind})`);
  }
}

async function cmdRun({ positional, flags }) {
  const [flowArg] = positional;
  if (!flowArg) usageError("run requires a <flow>");
  const { flowsDir, mapping } = resolvePaths(flags);
  const registry = await createRegistry(mapping);
  const path = await resolveFlowPath(flowArg, flowsDir);
  const { config } = await loadFlowConfig(path);
  const validation = await validateFlow(config, { mapping: registry.mapping });
  if (!validation.ok) {
    print(`INVALID: ${validation.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    process.exit(2);
  }
  const compiled = await compileFlow(config, {
    registry,
    options: { mock: flags.mock ?? true, dryRun: flags.dryRun ?? false, logger: flags.quiet ? nullLogger() : undefined },
  });
  const result = await runFlow(compiled, {
    input: parseInputs(flags.input),
    threadId: flags.thread,
    onEvent: flags.events ? printEvent : undefined,
  });
  report(result, flags);
}

async function cmdResume({ positional, flags }) {
  const [flowArg] = positional;
  if (!flowArg) usageError("resume requires a <flow>");
  if (!flags.thread) usageError("resume requires --thread <id>");
  let resume = { approve: true };
  if (flags.resumeJson) {
    try {
      resume = JSON.parse(flags.resumeJson);
    } catch (err) {
      usageError(`--resume-json is not valid JSON: ${err.message}`);
    }
  }
  const { flowsDir, mapping } = resolvePaths(flags);
  const registry = await createRegistry(mapping);
  const path = await resolveFlowPath(flowArg, flowsDir);
  const { config } = await loadFlowConfig(path);
  const compiled = await compileFlow(config, { registry, options: { mock: flags.mock ?? true, logger: flags.quiet ? nullLogger() : undefined } });
  const pending = await getThreadState(compiled, flags.thread);
  if (pending.pendingInterrupt === undefined && pending.next.length === 0) {
    print(`nothing to resume on thread '${flags.thread}' (unknown or already-completed thread for this flow's checkpointer)`);
    process.exit(1);
  }
  const result = await resumeFlow(compiled, {
    threadId: flags.thread,
    resume,
    onEvent: flags.events ? printEvent : undefined,
  });
  report(result, flags);
}

function report(result, flags) {
  if (flags.json) {
    return print(JSON.stringify({ status: result.status, threadId: result.threadId, interrupt: result.interrupt, state: result.state }, null, 2));
  }
  if (result.status === "interrupted") {
    print(`INTERRUPTED thread=${result.threadId}`);
    print(`  message: ${result.interrupt?.message ?? ""}`);
    if (result.interrupt?.payload) print(`  payload: ${JSON.stringify(result.interrupt.payload)}`);
    print(`  resume with: langgraph-langchain-harness resume <flow> --thread ${result.threadId} --resume-json '{"approve":true}'`);
    return;
  }
  print(`COMPLETED last_step=${result.state.last_step}`);
  const { error_logs: errors = [] } = result.state;
  for (const [key, value] of Object.entries(result.state)) {
    if (["error_logs", "last_step"].includes(key)) continue;
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    print(`  ${key} = ${rendered.length > 160 ? rendered.slice(0, 160) + "…" : rendered}`);
  }
  if (errors.length > 0) {
    print(`  error_logs (${errors.length}):`);
    for (const entry of errors) print(`    - ${entry}`);
  }
}

// ── dispatch ─────────────────────────────────────────────────────────────────

const HANDLERS = {
  list: cmdList,
  patterns: cmdPatterns,
  validate: cmdValidate,
  graph: cmdGraph,
  run: cmdRun,
  resume: cmdResume,
};

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.command || parsed.command === "help" || parsed.command === "--help") {
  print(USAGE);
  process.exit(0);
}
const handler = HANDLERS[parsed.command];
if (!handler) usageError(`unknown command '${parsed.command}'`);

try {
  await handler(parsed);
} catch (err) {
  const envelope = toErrorEnvelope(err);
  process.stderr.write(`${envelope.error.code}: ${envelope.error.message}\n`);
  if (envelope.error.details?.issues) {
    for (const issue of envelope.error.details.issues.slice(0, 10)) {
      process.stderr.write(`  ${issue.path}: ${issue.message}\n`);
    }
  }
  process.exit(envelope.error.code === "CONFIG_INVALID" || envelope.error.code === "CONFIG_LOAD" ? 2 : 1);
}
