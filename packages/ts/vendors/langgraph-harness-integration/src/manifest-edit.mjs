/**
 * src/manifest-edit.mjs — formatting-preserving, single-token package.json
 * edit (Epic 03, story 03/02/01; record 0019/D2). Renovate never round-trips
 * a manifest through JSON.parse/JSON.stringify — it parses a COPY for truth,
 * then swaps exactly one value token in the raw text (`replaceAsString`).
 * The failure mode this prevents is real: a naive global find/replace of
 * `"1.2.3"` can corrupt an unrelated field sharing the same string.
 *
 * `bumpNpmDependency` returns the edited string, or null whenever the edit
 * cannot be made provably-safe (absent section/dep, non-string value, value
 * token not locatable verbatim, ambiguous hits, or a post-edit sanity parse
 * that differs anywhere but the one path) — the caller records a skip, never
 * force-writes.
 */

/**
 * Span of the top-level `"<sectionKey>": { … }` object in the raw text —
 * depth-aware and string-aware, so nested keys with the same name never match.
 * Returns { start, end } indices of the section's braces, or null.
 */
function findSectionSpan(text, sectionName) {
  const sectionKey = JSON.stringify(sectionName);
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      if (depth === 1 && text.startsWith(sectionKey, i)) {
        const m = text.slice(i + sectionKey.length).match(/^\s*:\s*\{/);
        if (m) {
          const open = i + sectionKey.length + m[0].length - 1;
          let d = 0;
          let inStr = false;
          let esc = false;
          for (let j = open; j < text.length; j += 1) {
            const c = text[j];
            if (inStr) {
              if (esc) esc = false;
              else if (c === "\\") esc = true;
              else if (c === '"') inStr = false;
              continue;
            }
            if (c === '"') inStr = true;
            else if (c === "{") d += 1;
            else if (c === "}") {
              d -= 1;
              if (d === 0) return { start: open, end: j + 1 };
            }
          }
          return null;
        }
      }
      // skip over the string literal
      i += 1;
      let esc = false;
      while (i < text.length) {
        const c = text[i];
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') break;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  return null;
}

/** Key-order-insensitive deep equality over plain JSON values. */
function jsonDeepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonDeepEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && jsonDeepEqual(a[k], b[k]));
  }
  return false;
}

/** The indentation unit of a JSON document (first indented line; default two spaces). */
function detectIndent(text) {
  const m = String(text ?? "").match(/^([ \t]+)\S/m);
  return m ? m[1] : "  ";
}

/**
 * Write / update a top-level npm `overrides` entry — the transitive-pin
 * writer for the node ecosystem (change record 0032/D2, `npm-overrides-pin`).
 * A transitive vulnerability is remediated by INTRODUCING an override for a
 * package that is not a declared dependency, so unlike `bumpNpmDependency`
 * this writer may create the section it edits. Same safety contract: parse a
 * copy for truth, edit the raw text, reparse, and return null on anything
 * that cannot be made provably-safe.
 */
export function addNpmOverride(fileContent, depName, newValue) {
  if (typeof fileContent !== "string" || typeof depName !== "string" || depName.length === 0 || typeof newValue !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const existing = parsed.overrides;
  if (existing !== undefined && (existing === null || typeof existing !== "object" || Array.isArray(existing))) return null;
  if (existing?.[depName] === newValue) return null; // caller maps to "already at target"
  if (existing !== undefined && typeof existing?.[depName] === "string") {
    // entry exists with another value → single-token swap via the bump machinery
    return bumpNpmDependency(fileContent, depName, "overrides", newValue);
  }

  const indent = detectIndent(fileContent);
  const entry = `${JSON.stringify(depName)}: ${JSON.stringify(newValue)}`;
  let edited;
  if (existing !== undefined) {
    // section exists, entry does not → insert right after the opening brace
    const span = findSectionSpan(fileContent, "overrides");
    if (!span) return null;
    const body = fileContent.slice(span.start + 1, span.end - 1);
    if (body.trim() === "") {
      edited = `${fileContent.slice(0, span.start)}{ ${entry} }${fileContent.slice(span.end)}`;
    } else {
      const entryIndentMatch = body.match(/\n([ \t]+)\S/);
      const entryIndent = entryIndentMatch ? entryIndentMatch[1] : indent + indent;
      edited = `${fileContent.slice(0, span.start + 1)}\n${entryIndent}${entry},${fileContent.slice(span.start + 1)}`;
    }
  } else {
    // no overrides section → append one before the document's final brace
    const closeAt = fileContent.lastIndexOf("}");
    if (closeAt === -1) return null;
    const before = fileContent.slice(0, closeAt);
    const emptyRoot = before.trim() === "{";
    const trimmedBefore = before.replace(/[\s,]+$/, "");
    const block = `${emptyRoot ? "" : ","}\n${indent}"overrides": {\n${indent}${indent}${entry}\n${indent}}\n`;
    edited = `${trimmedBefore}${block}${fileContent.slice(closeAt)}`;
  }

  // Sanity: exactly the intended change, nothing else.
  let reparsed;
  try {
    reparsed = JSON.parse(edited);
  } catch {
    return null;
  }
  const expected = { ...parsed, overrides: { ...(parsed.overrides ?? {}), [depName]: newValue } };
  if (reparsed?.overrides?.[depName] !== newValue) return null;
  if (!jsonDeepEqual(reparsed, expected)) return null;
  return edited;
}

/**
 * Bump `depName` in the `depType` section of a raw package.json string to
 * `newValue`, touching exactly one value token. Null on anything unsafe.
 */
export function bumpNpmDependency(fileContent, depName, depType, newValue) {
  if (typeof fileContent !== "string" || typeof newValue !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    return null;
  }
  const oldValue = parsed?.[depType]?.[depName];
  if (typeof oldValue !== "string") return null;
  if (oldValue === newValue) return null; // caller maps to "already at target"

  const span = findSectionSpan(fileContent, depType);
  if (!span) return null;
  const section = fileContent.slice(span.start, span.end);

  // `"<depName>"` + `:` + `"<oldValue>"` — exactly one hit inside the section.
  const needleKey = JSON.stringify(depName);
  const needleValue = JSON.stringify(oldValue);
  const hits = [];
  let from = 0;
  while (true) {
    const keyAt = section.indexOf(needleKey, from);
    if (keyAt === -1) break;
    const m = section.slice(keyAt + needleKey.length).match(/^\s*:\s*/);
    if (m && section.startsWith(needleValue, keyAt + needleKey.length + m[0].length)) {
      hits.push(keyAt + needleKey.length + m[0].length);
    }
    from = keyAt + needleKey.length;
  }
  if (hits.length !== 1) return null;

  const valueAt = span.start + hits[0];
  const edited = fileContent.slice(0, valueAt) + JSON.stringify(newValue) + fileContent.slice(valueAt + needleValue.length);

  // Sanity: the edit changed that one path and nothing else — never emit a
  // corrupt manifest.
  let reparsed;
  try {
    reparsed = JSON.parse(edited);
  } catch {
    return null;
  }
  if (reparsed?.[depType]?.[depName] !== newValue) return null;
  parsed[depType][depName] = newValue;
  if (JSON.stringify(reparsed) !== JSON.stringify(parsed)) return null;
  return edited;
}
