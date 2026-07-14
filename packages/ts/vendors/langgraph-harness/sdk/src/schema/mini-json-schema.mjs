/**
 * schema/mini-json-schema.mjs — a small, deterministic JSON-Schema subset
 * validator (atomic service).
 *
 * Supports the subset the langgraph-langchain-harness DSL needs — type, required, properties,
 * additionalProperties (boolean), items, enum, const, minimum, maximum,
 * minLength, maxLength, minItems, maxItems, pattern, anyOf — with precise
 * dotted/indexed error paths like `nodes[3].with.model`. Zero dependencies,
 * no dynamic code, no remote refs: the whole grammar is closed by design.
 *
 * It is used twice: config-time (the meta-schema over feature yaml) and
 * runtime (the `validate.schema` output gates on llm/skill nodes).
 */

/** @typedef {{path: string, message: string}} Issue */

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "number") return Number.isInteger(value) ? "integer" : "number";
  return t; // string | boolean | object | undefined
}

function typeMatches(declared, actual) {
  if (declared === "number") return actual === "number" || actual === "integer";
  if (declared === "integer") return actual === "integer";
  return declared === actual;
}

/**
 * Validate `value` against `schema`. Returns a list of issues; empty = valid.
 * @param {any} value
 * @param {any} schema mini-json-schema object (or boolean)
 * @param {string} [path] base path used in issue messages
 * @returns {Issue[]}
 */
export function validateSchema(value, schema, path = "$") {
  /** @type {Issue[]} */
  const issues = [];
  walk(value, schema, path, issues);
  return issues;
}

/** True when `value` conforms to `schema`. */
export function matchesSchema(value, schema) {
  return validateSchema(value, schema).length === 0;
}

function walk(value, schema, path, issues) {
  if (schema === true || schema == null) return;
  if (schema === false) {
    issues.push({ path, message: "value not allowed (schema is false)" });
    return;
  }

  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((sub) => validateSchema(value, sub, path).length === 0);
    if (!ok) issues.push({ path, message: `does not match any of ${schema.anyOf.length} allowed shapes` });
    return;
  }

  const actual = typeOf(value);

  if (schema.const !== undefined && value !== schema.const) {
    issues.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
    return;
  }

  if (schema.enum !== undefined) {
    if (!schema.enum.some((e) => e === value)) {
      issues.push({ path, message: `expected one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")} (got ${JSON.stringify(value)})` });
      return;
    }
  }

  if (schema.type !== undefined) {
    const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!declared.some((t) => typeMatches(t, actual))) {
      issues.push({ path, message: `expected type ${declared.join("|")} (got ${actual})` });
      return; // no point checking type-specific constraints
    }
  }

  if (actual === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      issues.push({ path, message: `string shorter than minLength ${schema.minLength}` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      issues.push({ path, message: `string longer than maxLength ${schema.maxLength}` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))
      issues.push({ path, message: `string does not match pattern ${schema.pattern}` });
  }

  if (actual === "number" || actual === "integer") {
    if (schema.minimum !== undefined && value < schema.minimum)
      issues.push({ path, message: `number below minimum ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum)
      issues.push({ path, message: `number above maximum ${schema.maximum}` });
  }

  if (actual === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      issues.push({ path, message: `array shorter than minItems ${schema.minItems}` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      issues.push({ path, message: `array longer than maxItems ${schema.maxItems}` });
    if (schema.items !== undefined) {
      value.forEach((item, i) => walk(item, schema.items, `${path}[${i}]`, issues));
    }
  }

  if (actual === "object") {
    const props = schema.properties ?? {};
    for (const req of schema.required ?? []) {
      if (value[req] === undefined) issues.push({ path: `${path}.${req}`, message: "required property missing" });
    }
    for (const [key, sub] of Object.entries(props)) {
      if (value[key] !== undefined) walk(value[key], sub, `${path}.${key}`, issues);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) issues.push({ path: `${path}.${key}`, message: "unknown property" });
      }
    }
  }
}

/**
 * Produce a minimal value that CONFORMS to `schema` — the deterministic
 * skeleton the mock LLM provider returns for schema-constrained calls.
 * @param {any} schema
 * @param {string} [seedText] woven into generated strings for traceability
 */
export function skeletonFromSchema(schema, seedText = "mock") {
  if (schema === true || schema == null || schema === false) return `${seedText}`;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum !== undefined) return schema.enum[0];
  if (Array.isArray(schema.anyOf)) return skeletonFromSchema(schema.anyOf[0], seedText);
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (t) {
    case "string": {
      let s = seedText;
      if (schema.minLength !== undefined) while (s.length < schema.minLength) s += "-x";
      if (schema.maxLength !== undefined) s = s.slice(0, schema.maxLength);
      if (schema.pattern !== undefined) return seedText; // best effort; patterns are rare in configs
      return s;
    }
    case "integer":
    case "number": {
      let n = 0;
      if (schema.minimum !== undefined) n = Math.max(n, schema.minimum);
      if (schema.maximum !== undefined) n = Math.min(n, schema.maximum);
      return n;
    }
    case "boolean":
      return false;
    case "null":
      return null;
    case "array": {
      const min = schema.minItems ?? 0;
      return Array.from({ length: min }, (_, i) => skeletonFromSchema(schema.items, `${seedText}-${i}`));
    }
    case "object":
    default: {
      const out = {};
      const props = schema.properties ?? {};
      for (const req of schema.required ?? []) {
        out[req] = skeletonFromSchema(props[req], `${seedText}-${req}`);
      }
      return out;
    }
  }
}
