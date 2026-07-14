/**
 * src/document.mjs — the HTML escaper, the JSON data island, and the standalone-document shell.
 *
 * `esc` is the security seam for text the GENERATOR itself writes into markup: external data (repo
 * urls, package names, advisory summaries, the LLM-authored prompt) is DATA, never markup (security
 * rules §1/§2). The React tree escapes its own text; this is retained for generator-authored
 * fragments and for callers that compose with it.
 *
 * `serializeIsland` is the OTHER escaping problem — and it is emphatically not the same one.
 */

/** HTML-escape a value (external text is DATA — never raw markup). */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serialize `ReportData` for embedding in `<script type="application/json">` (record 0057/D2).
 *
 * ⚠️ `esc()` IS THE WRONG TOOL HERE, and reaching for it is the exact mistake this function exists
 * to prevent. `esc()` is an HTML text/attribute escaper, but inside a `<script>` element the browser
 * does NOT decode HTML entities — so `esc()` would both corrupt the JSON (`&quot;` is not a quote to
 * `JSON.parse`) and fail to neutralize the one sequence that actually matters.
 *
 * The hazard is `</script>`. The HTML tokenizer ends a script element at the first literal
 * `</script` in its text, wherever that appears — including in the middle of a JSON string. A repo
 * name, a CVE description, or an LLM-authored prompt containing it would close the tag early and
 * break out into markup. This is not hypothetical: `render.test.mjs` already feeds a prompt
 * containing `</script><script>alert(2)</script>` through the renderer, precisely because the
 * report's data is entirely external content — and v100 security rule 1 makes an unsanitized path
 * from external text into the page a BLOCKER finding.
 *
 * The fix is to emit every `<` as the JSON unicode escape `<`. It is legal JSON, so `JSON.parse`
 * round-trips it back to `<` unchanged; `<` cannot occur outside a string literal in JSON anyway;
 * and it makes the `</script` sequence unrepresentable in the emitted text.
 *
 * U+2028 and U+2029 get the same treatment for a different reason: they are legal inside a JSON
 * string but are LINE TERMINATORS to a JavaScript parser, so a payload carrying one can break a
 * script context even though the JSON itself is perfectly well-formed.
 */
export function serializeIsland(data) {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Wrap the rendered body in a complete, standalone HTML document.
 *
 * Everything is INLINE — stylesheet in `<style>`, hydration script in `<script>`, data in a JSON
 * island. No `<link href>`, no `<script src>`, no `@import`, no remote `url()`. That is asserted,
 * not merely intended: `render.test.mjs`'s offline check fails on any external reference, which is
 * what makes "embedded in a single HTML page" enforceable rather than aspirational. The report is
 * opened from a `file://` path as often as it is served.
 */
export function wrapDocument(body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Repository remediation report</title>
</head>
<body>
${body}
</body>
</html>
`;
}
