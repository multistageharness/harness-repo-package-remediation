/**
 * template/engine.mjs — the closed template micro-engine (atomic service).
 *
 * Supports exactly:
 *   {{key}} / {{key.path.deep}}   value interpolation (missing → "")
 *   {{json key}}                  JSON.stringify(value, null, 2)
 *   {{#if key}}...{{/if}}         truthy section
 *   {{#each key}}...{{/each}}     iterate arrays; inside, {{.}} is the item,
 *                                 {{@index}} the index, {{item.path}} digs in
 *
 * No helpers registry, no expressions, no prototype access (own-property
 * walks only) — the grammar is closed the same way expr.mjs is. `template.*`
 * atoms are thin wrappers over renderTemplate().
 */

function dig(scope, path) {
  if (path === ".") return scope["."] ?? scope;
  if (path === "@index") return scope["@index"];
  let current = path.startsWith(".") ? scope["."] ?? scope : scope;
  for (const part of path.replace(/^\./, "").split(".")) {
    if (part === "") continue;
    if (current == null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const SECTION_RE = /\{\{#(if|each)\s+([@.\w]+)\}\}([\s\S]*?)\{\{\/\1\}\}/;
const VAR_RE = /\{\{(json\s+)?([@.\w]+)\}\}/g;

/**
 * Render a template against a scope. Deterministic, throws never — missing
 * values render as empty string (reports must always materialize).
 */
export function renderTemplate(template, scope = {}) {
  let out = template;
  // innermost-first section expansion (bounded passes prevent pathological input)
  for (let pass = 0; pass < 50; pass++) {
    const m = SECTION_RE.exec(out);
    if (!m) break;
    const [whole, kind, path, body] = m;
    let replacement = "";
    const value = dig(scope, path);
    if (kind === "if") {
      // Handlebars falsy set: false, null/undefined, "", 0, empty array
      const truthy = Array.isArray(value) ? value.length > 0 : !!value;
      replacement = truthy ? renderInner(body, scope) : "";
    } else {
      const list = Array.isArray(value) ? value : [];
      replacement = list
        .map((item, i) => renderInner(body, { ...scope, ".": item, "@index": i, ...(item && typeof item === "object" ? item : {}) }))
        .join("");
    }
    out = out.slice(0, m.index) + replacement + out.slice(m.index + whole.length);
  }
  return renderInner(out, scope);
}

function renderInner(text, scope) {
  // handle nested sections inside each/if bodies first
  if (SECTION_RE.test(text)) {
    text = renderTemplate(text, scope);
  }
  return text.replace(VAR_RE, (_, jsonFlag, path) => {
    const value = dig(scope, path);
    if (jsonFlag) return value === undefined ? "null" : JSON.stringify(value, null, 2);
    return stringify(value);
  });
}

/** The variable names a template references at its top level (docs + validation). */
export function extractTemplateVars(template) {
  const vars = new Set();
  for (const m of template.matchAll(/\{\{(?:json\s+|#if\s+|#each\s+)?([@.\w]+)\}\}/g)) {
    const path = m[1];
    if (path.startsWith("@") || path === ".") continue;
    vars.add(path.split(".")[0]);
  }
  return [...vars];
}
