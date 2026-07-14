/**
 * loader/config-loader.mjs — stage 1 of the pipeline: **yaml** → normalized
 * flow config.
 *
 * Responsibilities:
 *   - read + parse the flow yaml (or json) file;
 *   - interpolate `${VAR}` / `${VAR:default}` env references (declared `env:`
 *     entries provide defaults and required-ness);
 *   - normalize: fill runtime defaults, tag edge shapes, inject the
 *     diagnostics channels (`error_logs`, `last_step`), auto-upgrade the
 *     checkpointer when an interrupt node is present, expand shorthands.
 *
 * The loader never touches the registry — it produces plain data. Stage 2
 * (mapping/registry) turns pattern names into imported functions.
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import YAML from "yaml";

import { ConfigLoadError, MissingEnvError } from "../errors.mjs";

/** Reducers the state factory understands. */
export const REDUCERS = ["last", "concat", "merge", "add"];

/** Channel types the state factory understands. */
export const CHANNEL_TYPES = ["string", "number", "boolean", "object", "array"];

/** Checkpointer shorthands → checkpoint pattern names. */
const CHECKPOINTER_SHORTHAND = {
  none: "checkpoints.none",
  memory: "checkpoints.memory",
  file: "checkpoints.file",
};

// ── env interpolation ────────────────────────────────────────────────────────

const FULL_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}$/;
const PARTIAL_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}/g;

/** Coerce "true"/"false"/numeric strings to typed scalars. */
export function coerceScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (value !== "" && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function makeEnvLookup(declaredEnv, envSource) {
  const declared = new Map();
  for (const entry of declaredEnv) declared.set(entry.name, entry);
  return (name, inlineDefault) => {
    const source = envSource[name];
    if (source !== undefined && source !== "") return source;
    if (inlineDefault !== undefined) return inlineDefault;
    const decl = declared.get(name);
    if (decl?.default !== undefined) return String(decl.default);
    if (decl?.required) throw new MissingEnvError(name);
    return "";
  };
}

/** Deep-walk a parsed document interpolating `${VAR:default}` in strings. */
export function interpolateEnv(doc, declaredEnv = [], envSource = process.env) {
  const lookup = makeEnvLookup(declaredEnv, envSource);
  const walk = (value) => {
    if (typeof value === "string") {
      const full = FULL_REF.exec(value);
      if (full) return coerceScalar(lookup(full[1], full[2]));
      return value.replace(PARTIAL_REF, (_, name, def) => lookup(name, def));
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return out;
    }
    return value;
  };
  return walk(doc);
}

// ── edge shape detection ─────────────────────────────────────────────────────

/**
 * Tag a raw edge descriptor with its shape. Shapes are recognized by
 * STRUCTURE, not by an explicit `shape:` key — the five forms are mutually
 * exclusive by construction. An explicit `uses:` escape hatch selects a
 * custom `edges.*` atom.
 */
export function detectEdgeShape(edge) {
  if (edge == null || typeof edge !== "object") return "invalid";
  if (typeof edge.uses === "string") return "custom";
  if (edge.loop && typeof edge.loop === "object") return "loop";
  if (edge.fanout && typeof edge.fanout === "object") return "fanout";
  if (edge.switch && typeof edge.switch === "object") return "switch";
  if (typeof edge.when === "string") return "conditional";
  if (typeof edge.from === "string" && typeof edge.to === "string") return "linear";
  return "invalid";
}

function normalizeEdge(edge, index) {
  const shape = detectEdgeShape(edge);
  switch (shape) {
    case "linear":
      return { shape, index, from: edge.from, to: edge.to };
    case "conditional":
      return { shape, index, from: edge.from, when: edge.when, to: edge.to, else: edge.else };
    case "switch":
      return {
        shape,
        index,
        from: edge.from,
        on: edge.switch.on,
        cases: edge.switch.cases ?? {},
        default: edge.switch.default,
      };
    case "loop":
      return {
        shape,
        index,
        from: edge.loop.from,
        body_from: edge.loop.body_from,
        until: edge.loop.until,
        max: edge.loop.max,
        on_max: edge.loop.on_max,
      };
    case "fanout":
      return {
        shape,
        index,
        from: edge.from,
        over: edge.fanout.over,
        to: edge.fanout.to,
        carry: edge.fanout.carry ?? [],
        then: edge.then,
      };
    case "custom":
      return { shape, index, uses: edge.uses, with: edge.with ?? {} };
    default:
      return { shape: "invalid", index, raw: edge };
  }
}

// ── normalization ────────────────────────────────────────────────────────────

function normalizeEnvEntries(env) {
  if (!Array.isArray(env)) return [];
  return env.map((e) => (typeof e === "string" ? { name: e, required: false } : { required: false, ...e }));
}

function normalizeValidate(v) {
  if (v == null) return null;
  return {
    schema: v.schema ?? null,
    on_invalid: v.on_invalid ?? "raise",
    fallback: v.fallback,
  };
}

function normalizeNode(node) {
  return {
    id: node.id,
    uses: node.uses,
    with: node.with ?? {},
    reads: node.reads ?? [],
    writes: node.writes ?? [],
    on_error: node.on_error ?? "raise",
    validate: normalizeValidate(node.validate),
    retry: node.retry ? { max: node.retry.max ?? 1, delay_ms: node.retry.delay_ms ?? 0 } : null,
  };
}

function normalizeState(state) {
  const out = {};
  for (const [name, decl] of Object.entries(state ?? {})) {
    if (typeof decl === "string") {
      out[name] = { type: decl, default: undefined, reducer: "last" };
    } else {
      out[name] = { type: decl.type ?? "string", default: decl.default, reducer: decl.reducer ?? "last" };
    }
  }
  return out;
}

/** The two diagnostics channels every flow gets (mirrors the harness canon). */
export const INJECTED_CHANNELS = {
  error_logs: { type: "array", default: [], reducer: "concat", injected: true },
  last_step: { type: "string", default: "", reducer: "last", injected: true },
};

function normalizeCheckpointer(runtime, nodes) {
  let cp = runtime.checkpointer ?? "auto";
  let params = runtime.checkpointer_params ?? {};
  if (typeof cp === "object" && cp !== null) {
    params = cp.with ?? {};
    cp = cp.uses;
  }
  const hasInterrupt = nodes.some((n) => n.uses === "nodes.interrupt");
  if (cp === "auto") cp = hasInterrupt ? "memory" : "none";
  if (cp in CHECKPOINTER_SHORTHAND) cp = CHECKPOINTER_SHORTHAND[cp];
  // interrupt requires a real checkpointer — auto-upgrade and let the
  // validator flag only an EXPLICIT none + interrupt combination.
  return { name: cp, params, auto_upgraded: false };
}

/**
 * Normalize a parsed + interpolated document into the canonical flow config.
 * Pure data-in/data-out (no fs, no registry).
 */
export function normalizeConfig(doc, { path = "<memory>", dir = "." } = {}) {
  const nodes = (Array.isArray(doc.nodes) ? doc.nodes : []).map(normalizeNode);
  const runtime = doc.runtime ?? {};
  const checkpointer = normalizeCheckpointer(runtime, nodes);
  return {
    version: doc.version,
    name: doc.name,
    description: doc.description ?? "",
    runtime: {
      recursion_limit: runtime.recursion_limit ?? 50,
      checkpointer: checkpointer.name,
      checkpointer_params: checkpointer.params,
      mock: runtime.mock ?? false,
      dry_run: runtime.dry_run ?? false,
    },
    env: normalizeEnvEntries(doc.env),
    types: doc.types ?? {},
    state: { ...normalizeState(doc.state), ...INJECTED_CHANNELS },
    entry: doc.entry,
    nodes,
    edges: (Array.isArray(doc.edges) ? doc.edges : []).map(normalizeEdge),
    meta: { path, dir },
  };
}

// ── file loading ─────────────────────────────────────────────────────────────

/**
 * Load, interpolate, and normalize a flow config file.
 *
 * @param {string} filePath yaml/json flow file
 * @param {{env?: object}} [opts] `env` overrides the interpolation source
 * @returns {Promise<{config: object, raw: object, text: string, path: string, dir: string}>}
 */
export async function loadFlowConfig(filePath, opts = {}) {
  const path = resolve(filePath);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new ConfigLoadError(`cannot read flow config '${filePath}': ${err.message}`, { path: filePath });
  }
  return parseFlowConfig(text, { path, dir: dirname(path), env: opts.env, format: extname(path) });
}

/**
 * Parse flow yaml/json text (exported separately so tests and the backend can
 * validate configs that are not on disk yet).
 */
export function parseFlowConfig(text, { path = "<memory>", dir = ".", env = process.env, format = ".yaml" } = {}) {
  let raw;
  try {
    raw = format === ".json" ? JSON.parse(text) : YAML.parse(text);
  } catch (err) {
    throw new ConfigLoadError(`flow config parse error: ${err.message}`, { path });
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigLoadError("flow config must be a yaml/json mapping at the top level", { path });
  }
  const declaredEnv = normalizeEnvEntries(raw.env);
  const interpolated = interpolateEnv(raw, declaredEnv, env);
  const config = normalizeConfig(interpolated, { path, dir });
  return { config, raw, text, path, dir };
}

/**
 * Scan a directory for flow configs (non-recursive; `.yaml`/`.yml`/`.json`).
 * Returns lightweight descriptors without validating.
 */
export async function scanFlows(flowsDir) {
  const dir = resolve(flowsDir);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new ConfigLoadError(`cannot list flows dir '${flowsDir}': ${err.message}`, { dir: flowsDir });
  }
  const flows = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const ext = extname(ent.name);
    if (![".yaml", ".yml", ".json"].includes(ext)) continue;
    const path = join(dir, ent.name);
    try {
      const text = await readFile(path, "utf8");
      const doc = ext === ".json" ? JSON.parse(text) : YAML.parse(text);
      if (!doc || typeof doc !== "object" || !doc.name || !doc.nodes) continue; // data fixture, not a flow
      flows.push({
        name: doc.name,
        file: ent.name,
        path,
        description: doc.description ?? "",
        nodes: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
        edges: Array.isArray(doc.edges) ? doc.edges.length : 0,
      });
    } catch {
      // unparseable file in the flows dir — skip it; `validate` surfaces details
    }
  }
  return flows.sort((a, b) => a.name.localeCompare(b.name));
}
