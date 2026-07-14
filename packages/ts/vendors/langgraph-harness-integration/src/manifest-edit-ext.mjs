/**
 * src/manifest-edit-ext.mjs — pip + maven manifest writers (change record
 * 0032/D2 transitive-pin writers + 0032/D4 direct-bump halves). The
 * `versioning/*` research tree supplies only the version MATH; these are the
 * manifest-writing halves the harness authors itself (next-steps
 * `version-change-utilities.md` §5 — "two halves, don't conflate them").
 *
 * Same safety contract as `manifest-edit.mjs`: pure string in → edited string
 * out, `null` whenever the edit cannot be made provably-safe (absent target,
 * ambiguous hits, non-literal versions), and the caller records the skip —
 * never a force-write, never a throw.
 */

// ── pip ──────────────────────────────────────────────────────────────────────

/**
 * PEP 503 name normalization: pip package names compare case-insensitively
 * with `-`, `_`, `.` interchangeable.
 */
export function normalizePipName(name) {
  return String(name ?? "").toLowerCase().replace(/[-_.]+/g, "-");
}

/** Parse one requirements line → { name, extras, operator, version, comment } | null. */
function parseRequirementLine(line) {
  const m = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(==|>=|~=|<=|!=|>|<)\s*([^\s#;]+)\s*(#.*)?$/);
  if (!m) return null;
  return { name: m[1], extras: m[2] ?? "", operator: m[3], version: m[4], comment: m[5] ?? "" };
}

/**
 * Direct-bump a pinned requirement (`name==old` → `name==new`, operator
 * preserved for `==`/`>=`/`~=`) in requirements.txt-style text (0032/D4,
 * `pip-requirement-bump`). Exactly one matching line or null.
 */
export function bumpPipRequirement(fileContent, depName, _depType, newValue) {
  if (typeof fileContent !== "string" || typeof newValue !== "string" || newValue.length === 0) return null;
  const want = normalizePipName(depName);
  const lines = fileContent.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseRequirementLine(lines[i]);
    if (parsed && normalizePipName(parsed.name) === want) hits.push({ index: i, parsed });
  }
  if (hits.length !== 1) return null;
  const { index, parsed } = hits[0];
  if (!["==", ">=", "~="].includes(parsed.operator)) return null; // ceilings/exclusions need range algebra
  if (parsed.version === newValue) return null; // caller maps to "already at target"
  const suffix = parsed.comment ? `  ${parsed.comment}` : "";
  lines[index] = `${parsed.name}${parsed.extras}${parsed.operator}${newValue}${suffix}`;
  return lines.join("\n");
}

/**
 * Direct-bump writer for a PEP 621 `pyproject.toml` (0065). Bumps a pinned
 * requirement inside the `dependencies = [ … ]` array:
 *
 *     dependencies = [
 *       "jinja2==3.1.0",     ->     "jinja2==3.1.4",
 *     ]
 *
 * Until 0065 pyproject.toml was READ (manifest-deps registers a reader) but never
 * WRITTEN, so a pyproject-declared package recorded "manifest edit failed". That
 * gap was invisible while the dataset named only ONE manifest per finding; D1's
 * multi-module discovery surfaced it — `batch-jsonl-pip` pins jinja2 in BOTH
 * requirements.txt and pyproject.toml, and only the former was ever remediated.
 *
 * Same discipline as `bumpPipRequirement`: exactly one hit, only the operators we
 * can reason about, and `null` (→ an honest "manifest edit failed") for anything
 * outside the grammar rather than a guessed rewrite. Poetry's
 * `[tool.poetry.dependencies]` table is a DIFFERENT grammar (`name = "ver"`) and
 * is deliberately NOT handled here — it returns null rather than a wrong edit.
 */
export function bumpPyprojectDependency(fileContent, depName, _depType, newValue) {
  if (typeof fileContent !== "string" || typeof newValue !== "string" || newValue.length === 0) return null;
  const want = normalizePipName(depName);
  const lines = fileContent.split("\n");
  // A quoted PEP 508 requirement string inside an array: leading indent, the
  // requirement, optional trailing comma. Captured so the exact layout survives.
  const ENTRY = /^(\s*)(["'])([^"']+)\2(\s*,?\s*)$/;
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = ENTRY.exec(lines[i]);
    if (m === null) continue;
    const parsed = parseRequirementLine(m[3]);
    if (parsed && normalizePipName(parsed.name) === want) hits.push({ index: i, indent: m[1], quote: m[2], tail: m[4], parsed });
  }
  if (hits.length !== 1) return null;
  const { index, indent, quote, tail, parsed } = hits[0];
  if (!["==", ">=", "~="].includes(parsed.operator)) return null; // ceilings/exclusions need range algebra
  if (parsed.version === newValue) return null; // caller maps to "already at target"
  lines[index] = `${indent}${quote}${parsed.name}${parsed.extras}${parsed.operator}${newValue}${quote}${tail}`;
  return lines.join("\n");
}

/**
 * Python direct-bump dispatcher (0065): pick the writer from the MANIFEST, since
 * one ecosystem legitimately owns two manifest grammars. `manifestPath` is the
 * 5th argument the remediate atom now passes; when it is absent we fall back to
 * requirements.txt, preserving the pre-0065 behavior for every existing caller.
 */
export function bumpPythonDependency(fileContent, depName, depType, newValue, manifestPath = null) {
  const base = typeof manifestPath === "string" ? manifestPath.split("/").pop() : null;
  return base === "pyproject.toml"
    ? bumpPyprojectDependency(fileContent, depName, depType, newValue)
    : bumpPipRequirement(fileContent, depName, depType, newValue);
}

/**
 * Transitive-pin writer for python (0032/D2, `pip-constraints-pin`): ensure
 * `depName==newValue` in a pip constraints file. `fileContent` may be null
 * (file absent — a fresh constraints document is created). Returns the full
 * new text, or null when the pin is already exact.
 */
export function pinPipConstraint(fileContent, depName, newValue) {
  if (typeof depName !== "string" || depName.length === 0 || typeof newValue !== "string" || newValue.length === 0) return null;
  const pin = `${depName}==${newValue}`;
  if (fileContent === null || fileContent === undefined || String(fileContent).trim() === "") {
    return `# transitive pins written by harness remediation (record 0032/D2)\n${pin}\n`;
  }
  const text = String(fileContent);
  const want = normalizePipName(depName);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseRequirementLine(lines[i]);
    if (parsed && normalizePipName(parsed.name) === want) {
      if (parsed.operator === "==" && parsed.version === newValue) return null; // already pinned
      lines[i] = pin;
      return lines.join("\n");
    }
  }
  const body = text.endsWith("\n") ? text : `${text}\n`;
  return `${body}${pin}\n`;
}

// ── maven ────────────────────────────────────────────────────────────────────

/** Split a maven package coordinate `groupId:artifactId` → [g, a] | null. */
export function splitMavenName(name) {
  const parts = String(name ?? "").split(":");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) return null;
  return parts;
}

/** All `<dependency>…</dependency>` spans matching g:a inside `text`. */
function findMavenDependencySpans(text, groupId, artifactId) {
  const spans = [];
  const re = /<dependency>[\s\S]*?<\/dependency>/g;
  for (;;) {
    const m = re.exec(text);
    if (m === null) break;
    const block = m[0];
    const g = block.match(/<groupId>\s*([^<]+?)\s*<\/groupId>/);
    const a = block.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/);
    if (g?.[1] === groupId && a?.[1] === artifactId) spans.push({ start: m.index, end: m.index + block.length, block });
  }
  return spans;
}

/** Replace the `<version>` text inside one dependency block. Null when unsafe. */
function replaceBlockVersion(block, newValue) {
  const v = block.match(/<version>\s*([^<]*?)\s*<\/version>/);
  if (!v) return null; // version managed elsewhere (BOM/parent) — not a token edit
  const current = v[1];
  if (current.includes("${")) return null; // property-valued — needs property resolution
  if (current === newValue) return null; // caller maps to "already at target"
  return block.replace(v[0], v[0].replace(current, newValue));
}

/**
 * Direct-bump the `<version>` of the g:a dependency in a pom.xml (0032/D4,
 * the maven bump half; signature matches the registry bump contract).
 * Exactly one matching `<dependency>` block or null.
 */
export function bumpMavenDependency(fileContent, depName, _depType, newValue) {
  if (typeof fileContent !== "string" || typeof newValue !== "string" || newValue.length === 0) return null;
  const coord = splitMavenName(depName);
  if (!coord) return null;
  const spans = findMavenDependencySpans(fileContent, coord[0], coord[1]);
  if (spans.length !== 1) return null;
  const edited = replaceBlockVersion(spans[0].block, newValue);
  if (edited === null) return null;
  return fileContent.slice(0, spans[0].start) + edited + fileContent.slice(spans[0].end);
}

/**
 * Transitive-pin writer for maven (0032/D2, `maven-dependency-pin`): pin g:a
 * to `newValue` in `<dependencyManagement><dependencies>`, creating the
 * section when absent (inserted before `</project>`). Returns edited text or
 * null (already pinned / unsafe).
 */
export function pinMavenDependencyManagement(fileContent, depName, newValue) {
  if (typeof fileContent !== "string" || typeof newValue !== "string" || newValue.length === 0) return null;
  const coord = splitMavenName(depName);
  if (!coord) return null;
  const [groupId, artifactId] = coord;

  const dmMatch = fileContent.match(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/);
  if (dmMatch) {
    const dm = dmMatch[0];
    const spans = findMavenDependencySpans(dm, groupId, artifactId);
    if (spans.length > 1) return null;
    if (spans.length === 1) {
      const edited = replaceBlockVersion(spans[0].block, newValue);
      if (edited === null) return null; // already pinned (or property-valued)
      const newDm = dm.slice(0, spans[0].start) + edited + dm.slice(spans[0].end);
      return fileContent.replace(dm, newDm);
    }
    const depsClose = dm.lastIndexOf("</dependencies>");
    if (depsClose === -1) return null;
    const indentMatch = dm.match(/\n([ \t]+)<dependency>/);
    const unit = indentMatch ? indentMatch[1] : "      ";
    const inner = unit.slice(0, Math.max(2, Math.floor(unit.length / 3))) || "  ";
    const entry = `${unit}<dependency>\n${unit}${inner}<groupId>${groupId}</groupId>\n${unit}${inner}<artifactId>${artifactId}</artifactId>\n${unit}${inner}<version>${newValue}</version>\n${unit}</dependency>\n`;
    const closeIndentMatch = dm.slice(0, depsClose).match(/\n([ \t]*)$/);
    const closePad = closeIndentMatch ? closeIndentMatch[1] : "";
    const newDm = `${dm.slice(0, depsClose - closePad.length)}${entry}${closePad}${dm.slice(depsClose)}`;
    return fileContent.replace(dm, newDm);
  }

  const projectClose = fileContent.lastIndexOf("</project>");
  if (projectClose === -1) return null;
  const indent = fileContent.match(/\n([ \t]+)</)?.[1] ?? "  ";
  const i1 = indent;
  const i2 = indent + indent;
  const i3 = i2 + indent;
  const i4 = i3 + indent;
  const block = `${i1}<dependencyManagement>\n${i2}<dependencies>\n${i3}<dependency>\n${i4}<groupId>${groupId}</groupId>\n${i4}<artifactId>${artifactId}</artifactId>\n${i4}<version>${newValue}</version>\n${i3}</dependency>\n${i2}</dependencies>\n${i1}</dependencyManagement>\n`;
  return `${fileContent.slice(0, projectClose)}${block}${fileContent.slice(projectClose)}`;
}
