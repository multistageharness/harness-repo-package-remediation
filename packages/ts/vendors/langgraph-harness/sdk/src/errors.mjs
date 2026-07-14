/**
 * errors.mjs — the langgraph-langchain-harness error taxonomy.
 *
 * Every failure the pipeline can produce is one of these classes, each carrying
 * a stable machine `code` and (where it exists) a precise config `path` such as
 * `nodes[3].with.model`. The backend maps them onto HTTP status codes and the
 * CLI onto exit codes — one taxonomy, three surfaces.
 */

export class LanggraphLangchainHarnessError extends Error {
  /**
   * @param {string} code stable machine-readable code (SCREAMING_SNAKE)
   * @param {string} message human message
   * @param {object} [details] structured details (path, cause, ...)
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

/** Config file could not be read/parsed (yaml syntax, missing file, bad include). */
export class ConfigLoadError extends LanggraphLangchainHarnessError {
  constructor(message, details) {
    super("CONFIG_LOAD", message, details);
  }
}

/** Config parsed but violates the meta-schema or a structural invariant. */
export class ConfigValidationError extends LanggraphLangchainHarnessError {
  /**
   * @param {Array<{path: string, message: string}>} issues
   */
  constructor(issues, details = {}) {
    const head = issues[0] ? `${issues[0].path}: ${issues[0].message}` : "invalid config";
    super("CONFIG_INVALID", `config validation failed — ${head}${issues.length > 1 ? ` (+${issues.length - 1} more)` : ""}`, {
      ...details,
      issues,
    });
    this.issues = issues;
  }
}

/** A declared-required env var is unset. */
export class MissingEnvError extends LanggraphLangchainHarnessError {
  constructor(name) {
    super("MISSING_ENV", `required env var '${name}' is not set and has no default`, { name });
  }
}

/** Mapping file missing/invalid, or a pattern name has no mapping entry. */
export class MappingError extends LanggraphLangchainHarnessError {
  constructor(message, details) {
    super("MAPPING", message, details);
  }
}

/** Dynamic import of a mapped module failed, or the export/meta contract is broken. */
export class RegistryError extends LanggraphLangchainHarnessError {
  constructor(message, details) {
    super("REGISTRY", message, details);
  }
}

/** A mapped module resolves outside the allowed trust roots. */
export class TrustBoundaryError extends LanggraphLangchainHarnessError {
  constructor(message, details) {
    super("TRUST_BOUNDARY", message, details);
  }
}

/** `when`/`until` expression rejected by the closed grammar. */
export class ExprError extends LanggraphLangchainHarnessError {
  constructor(message, source) {
    super("EXPR", source ? `${message} (in \`${source}\`)` : message, { source });
  }
}

/** Node runtime failure after the node's error policy was applied. */
export class NodeExecutionError extends LanggraphLangchainHarnessError {
  constructor(nodeId, message, details = {}) {
    super("NODE_EXECUTION", `node '${nodeId}' failed: ${message}`, { nodeId, ...details });
  }
}

/** An llm/skill output failed its declared schema gate with on_invalid: raise. */
export class OutputValidationError extends LanggraphLangchainHarnessError {
  constructor(nodeId, issues, details = {}) {
    super(
      "OUTPUT_INVALID",
      `node '${nodeId}' output failed schema validation — ${issues[0]?.path ?? ""}: ${issues[0]?.message ?? "invalid"}`,
      { nodeId, issues, ...details },
    );
    this.issues = issues;
  }
}

/** Flow not found / run not found — surfaced as 404 by the backend. */
export class NotFoundError extends LanggraphLangchainHarnessError {
  constructor(message, details) {
    super("NOT_FOUND", message, details);
  }
}

/** Convert any thrown value into a serializable error envelope. */
export function toErrorEnvelope(err) {
  if (err instanceof LanggraphLangchainHarnessError) return err.toJSON();
  return {
    error: {
      code: "INTERNAL",
      message: err instanceof Error ? err.message : String(err),
      details: {},
    },
  };
}
