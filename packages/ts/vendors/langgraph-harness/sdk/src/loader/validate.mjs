/**
 * loader/validate.mjs — config-time validation: the meta-schema plus the
 * structural invariants JSON-Schema can't express. Every issue carries a
 * precise path (`nodes[3].with.model`) so failures are actionable from the
 * CLI, the API error envelope, and the frontend alike.
 *
 * Invariants (numbered for the docs):
 *   I1  meta-schema conformance (shape/types/enums)
 *   I2  state channels well-formed; `__`-prefixed names reserved
 *   I3  node ids unique
 *   I4  entry references a real node
 *   I5  every node's `uses` resolves in the mapping to a node-producing
 *       category (skills | commands | knowledge | nodes)
 *   I6  every edge endpoint references a real node id (or END where legal)
 *   I7  loop edges are bounded (max >= 1, on_max resolves, until parses)
 *   I8  `when` / `until` expressions parse under the closed grammar and only
 *       read declared channels
 *   I9  nodes.interrupt requires a non-none checkpointer
 *   I10 fanout edges: `over` is an array channel, endpoints resolve
 *   I11 reads/writes reference declared channels
 *   I12 referenced assets exist on disk (prompt/template/config/source paths)
 *   I13 node `validate.schema` string refs resolve in `types`
 *   I14 checkpointer pattern resolves in the mapping to category checkpoints
 */

import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { ConfigValidationError } from "../errors.mjs";
import { validateSchema } from "../schema/mini-json-schema.mjs";
import { metaSchema, channelSchema, edgeSchemas } from "../schema/meta-schema.mjs";
import { parseExpr, extractChannels } from "../expr/expr.mjs";

export const END_TOKEN = "END";
const NODE_CATEGORIES = new Set(["skills", "commands", "knowledge", "nodes"]);
/** `with` keys whose string values are file/dir assets checked at config time. */
const ASSET_KEYS = ["prompt", "template", "config", "source"];

/**
 * Validate a normalized flow config.
 *
 * @param {object} config normalized config (from loadFlowConfig)
 * @param {object} opts
 * @param {import("../mapping/mapping-loader.mjs").Mapping} [opts.mapping]
 *        resolved mapping — enables I5/I14 pattern checks
 * @param {boolean} [opts.checkAssets=true] verify referenced files exist
 * @param {boolean} [opts.throwOnError=false]
 * @returns {Promise<{ok: boolean, issues: Array, warnings: Array}>}
 */
export async function validateFlow(config, opts = {}) {
  const { mapping = null, checkAssets = true, throwOnError = false } = opts;
  const issues = [];
  const warnings = [];

  // I1 — meta-schema
  issues.push(...validateSchema(config, metaSchema, "$"));

  // I2 — channels
  const channels = config.state ?? {};
  for (const [name, decl] of Object.entries(channels)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      issues.push({ path: `state.${name}`, message: "channel name must be an identifier" });
      continue;
    }
    if (name.startsWith("__")) {
      issues.push({ path: `state.${name}`, message: "channel names starting with '__' are reserved for the compiler" });
    }
    issues.push(...validateSchema(decl, channelSchema, `state.${name}`));
  }
  const channelNames = new Set(Object.keys(channels));

  // I3 — node ids unique
  const nodes = Array.isArray(config.nodes) ? config.nodes : [];
  const nodeIds = new Set();
  nodes.forEach((node, i) => {
    if (!node?.id) return; // meta-schema already flagged
    if (nodeIds.has(node.id)) issues.push({ path: `nodes[${i}].id`, message: `duplicate node id '${node.id}'` });
    nodeIds.add(node.id);
  });

  const isTarget = (ref) => nodeIds.has(ref) || ref === END_TOKEN;

  // I4 — entry
  if (config.entry && !nodeIds.has(config.entry)) {
    issues.push({ path: "entry", message: `entry '${config.entry}' is not a declared node id` });
  }

  // I5 — node `uses` resolve to node-producing categories
  if (mapping) {
    nodes.forEach((node, i) => {
      if (!node?.uses) return;
      const entry = mapping.get(node.uses);
      if (!entry) {
        issues.push({ path: `nodes[${i}].uses`, message: `pattern '${node.uses}' is not in the mapping` });
      } else if (!NODE_CATEGORIES.has(entry.category)) {
        issues.push({
          path: `nodes[${i}].uses`,
          message: `pattern '${node.uses}' is category '${entry.category}' — nodes may only use skills|commands|knowledge|nodes patterns`,
        });
      }
    });
  }

  // Edge invariants — I6/I7/I8/I10
  const edges = Array.isArray(config.edges) ? config.edges : [];
  let interruptPresent = nodes.some((n) => n.uses === "nodes.interrupt");

  edges.forEach((edge, i) => {
    const at = (k) => `edges[${i}].${k}`;
    if (edge.shape === "invalid") {
      issues.push({ path: `edges[${i}]`, message: "unrecognized edge shape — expected linear|conditional|switch|loop|fanout|custom(uses)" });
      return;
    }
    issues.push(...validateSchema(edge, edgeSchemas[edge.shape], `edges[${i}]`));

    const checkFrom = (ref, key) => {
      if (ref && !nodeIds.has(ref)) issues.push({ path: at(key), message: `'${ref}' is not a declared node id` });
    };
    const checkTo = (ref, key) => {
      if (ref && !isTarget(ref)) issues.push({ path: at(key), message: `'${ref}' is not a declared node id or END` });
    };

    switch (edge.shape) {
      case "linear":
        checkFrom(edge.from, "from");
        checkTo(edge.to, "to");
        break;
      case "conditional": {
        checkFrom(edge.from, "from");
        checkTo(edge.to, "to");
        if (edge.else !== undefined) checkTo(edge.else, "else");
        validateExpression(edge.when, at("when"), channelNames, issues);
        break;
      }
      case "switch": {
        checkFrom(edge.from, "from");
        if (edge.on && !channelNames.has(edge.on)) {
          issues.push({ path: at("on"), message: `switch reads undeclared channel '${edge.on}'` });
        }
        for (const [caseKey, target] of Object.entries(edge.cases ?? {})) {
          checkTo(target, `cases.${caseKey}`);
        }
        if (edge.default !== undefined) checkTo(edge.default, "default");
        else warnings.push({ path: at("default"), message: "switch without default — unmatched values will raise at runtime" });
        break;
      }
      case "loop": {
        // I7 — bounded loops
        checkFrom(edge.from, "from");
        checkFrom(edge.body_from, "body_from");
        checkTo(edge.on_max, "on_max");
        if (edge.until !== undefined) validateExpression(edge.until, at("until"), channelNames, issues);
        break;
      }
      case "fanout": {
        // I10
        checkFrom(edge.from, "from");
        checkFrom(edge.to, "to"); // fanout target must be a node (branch body), not END
        checkTo(edge.then, "then");
        if (edge.over && channelNames.has(edge.over)) {
          if (channels[edge.over]?.type !== "array") {
            issues.push({ path: at("over"), message: `fanout 'over' channel '${edge.over}' must be array-typed` });
          }
          for (const branchChannel of [`${edge.over}_item`, `${edge.over}_index`]) {
            if (!channelNames.has(branchChannel)) {
              issues.push({ path: at("over"), message: `fanout requires branch channel '${branchChannel}' to be declared in state` });
            }
          }
        } else if (edge.over) {
          issues.push({ path: at("over"), message: `fanout reads undeclared channel '${edge.over}'` });
        }
        for (const [ci, c] of (edge.carry ?? []).entries()) {
          if (!channelNames.has(c)) issues.push({ path: at(`carry[${ci}]`), message: `carry channel '${c}' is undeclared` });
        }
        break;
      }
      case "custom": {
        if (mapping) {
          const entry = mapping.get(edge.uses);
          if (!entry) issues.push({ path: at("uses"), message: `pattern '${edge.uses}' is not in the mapping` });
          else if (entry.category !== "edges") {
            issues.push({ path: at("uses"), message: `pattern '${edge.uses}' is category '${entry.category}' — custom edges must use an edges.* pattern` });
          }
        }
        break;
      }
    }
  });

  // I9 — interrupt requires checkpointer
  if (interruptPresent && config.runtime?.checkpointer === "checkpoints.none") {
    issues.push({
      path: "runtime.checkpointer",
      message: "flow contains a nodes.interrupt node — checkpointer must not be 'none' (use memory or file)",
    });
  }

  // I11 — reads/writes reference declared channels
  nodes.forEach((node, i) => {
    (node.reads ?? []).forEach((r, j) => {
      if (!channelNames.has(r)) issues.push({ path: `nodes[${i}].reads[${j}]`, message: `reads undeclared channel '${r}'` });
    });
    (node.writes ?? []).forEach((w, j) => {
      if (!channelNames.has(w)) issues.push({ path: `nodes[${i}].writes[${j}]`, message: `writes undeclared channel '${w}'` });
    });
  });

  // I13 — validate.schema type refs
  nodes.forEach((node, i) => {
    const schema = node.validate?.schema;
    if (typeof schema === "string" && !(schema in (config.types ?? {}))) {
      issues.push({ path: `nodes[${i}].validate.schema`, message: `type '${schema}' is not declared in types` });
    }
    if (node.validate?.on_invalid === "degrade" && node.validate.fallback === undefined) {
      warnings.push({ path: `nodes[${i}].validate.fallback`, message: "on_invalid: degrade without fallback — the invalid output channel will be left unwritten" });
    }
  });

  // I14 — checkpointer pattern resolves
  if (mapping && config.runtime?.checkpointer) {
    const entry = mapping.get(config.runtime.checkpointer);
    if (!entry) {
      issues.push({ path: "runtime.checkpointer", message: `checkpointer pattern '${config.runtime.checkpointer}' is not in the mapping` });
    } else if (entry.category !== "checkpoints") {
      issues.push({ path: "runtime.checkpointer", message: `'${config.runtime.checkpointer}' is category '${entry.category}', expected checkpoints` });
    }
  }

  // I12 — asset existence (async fs checks, batched)
  if (checkAssets) {
    const baseDir = config.meta?.dir ?? ".";
    const checks = [];
    nodes.forEach((node, i) => {
      for (const key of ASSET_KEYS) {
        const value = node.with?.[key];
        if (typeof value !== "string" || value.length === 0) continue;
        const target = isAbsolute(value) ? value : resolve(baseDir, value);
        checks.push(
          access(target).catch(() => {
            issues.push({ path: `nodes[${i}].with.${key}`, message: `referenced asset '${value}' does not exist (resolved ${target})` });
          }),
        );
      }
    });
    await Promise.all(checks);
  }

  const ok = issues.length === 0;
  if (!ok && throwOnError) throw new ConfigValidationError(issues, { name: config.name });
  return { ok, issues, warnings };
}

function validateExpression(src, path, channelNames, issues) {
  if (typeof src !== "string") return;
  try {
    parseExpr(src);
  } catch (err) {
    issues.push({ path, message: `expression rejected: ${err.message}` });
    return;
  }
  for (const chan of extractChannels(src)) {
    if (!channelNames.has(chan) && !chan.startsWith("__")) {
      issues.push({ path, message: `expression reads undeclared channel '${chan}'` });
    }
  }
}
