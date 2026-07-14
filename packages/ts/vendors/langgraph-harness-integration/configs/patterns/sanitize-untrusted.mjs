/**
 * commands.sanitizeUntrusted — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): the zero-trust seam that
 * `.claude/rules/v100-security-rules.md` §1 requires between an external-text
 * source (`commands.httpFetch`, `commands.ghCli`) and any `skills.*` node.
 *
 * Change record 0021/D5.1 makes this the ONE hard blocker on the `remote_csv`
 * ingest lane: a fetched CSV body flows `httpFetch → rows → dataset → … →
 * skills.detectSetup`, and an UNSANITIZED path from a fetch atom to a `skills.*`
 * node is a blocker finding. This atom closes that path.
 *
 * Two obligations, both from the rules file:
 *   §1 — external text is DATA, never instructions. Embedded directives are
 *        NEUTRALIZED in the emitted text (replaced by `[neutralized:<rule>]`),
 *        so nothing downstream — LLM prompt, excerpt, report — can re-animate
 *        them. Control characters (which can smuggle prompt boundaries past a
 *        naive scanner) are stripped; `\n`, `\r`, `\t` survive because CSV needs
 *        them.
 *   §2 — injection attempts are FINDINGS. Every neutralization is recorded as a
 *        `major` finding (rule id, byte offset, an 80-char excerpt) on the
 *        optional `findings_into` channel and otherwise ignored.
 *
 * Bounded (platform rule 4): `max_bytes` (default 2 MiB, matching
 * `commands.httpFetch`'s own cap) truncates before any scanning, so a
 * pathological body can't drive the regex sweep unbounded. Truncation is itself
 * a finding, never silent.
 *
 * Pure + deterministic: no fs, no network, no seam, no shell. Like
 * `commands.fsRead` and `commands.harnessIngest` it therefore runs FOR REAL even
 * under `--mock` — sanitization is not a thing you mock away.
 */

export const meta = {
  name: "commands.sanitizeUntrusted",
  category: "commands",
  summary: "Neutralize untrusted external text (zero-trust §1) → sanitized string + `major` injection findings (§2).",
  params: {
    type: "object",
    required: ["content_from", "into"],
    properties: {
      content_from: { type: "string", minLength: 1 },
      // when the source channel holds an object (e.g. httpFetch's {status, body}),
      // read this field off it. Default "body".
      field: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      findings_into: { type: "string", minLength: 1 },
      max_bytes: { type: "integer", minimum: 1 },
    },
  },
  returns: "node",
};

/** Bounded-execution default — same cap `commands.httpFetch` applies to a body. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The closed set of directive shapes we neutralize. Deliberately conservative
 * and named: every hit becomes a finding, so a false positive is visible in the
 * report rather than silently mangling data.
 */
const INJECTION_RULES = [
  { id: "ignore-instructions", re: /ignore\s+(?:all\s+)?(?:your\s+|the\s+)?(?:previous|prior|above|earlier|preceding)\s+instructions?/gi },
  { id: "disregard-instructions", re: /disregard\s+(?:all\s+)?(?:your\s+|the\s+)?(?:previous|prior|above|system|earlier)\s+\w+/gi },
  { id: "new-instructions", re: /(?:new|updated)\s+instructions?\s*:/gi },
  { id: "role-override", re: /you\s+are\s+now\s+(?:a|an|the)\b/gi },
  { id: "system-prompt-reference", re: /system\s+prompt/gi },
  { id: "chat-turn-marker", re: /<\|im_(?:start|end)\|>/gi },
  { id: "role-marker", re: /^\s*(?:system|assistant|human)\s*:/gim },
  { id: "approve-request", re: /(?:approve|merge|lgtm)\s+(?:this|the)\s+(?:pr|pull\s+request|change)/gi },
  { id: "exfiltration-request", re: /(?:print|reveal|output|leak|exfiltrate)\s+(?:your\s+|the\s+)?(?:api[\s_-]?key|secret|token|credentials?|env(?:ironment)?\s+variables?)/gi },
  { id: "tool-invocation", re: /<(?:function_calls|invoke|antml:invoke)\b[^>]*>/gi },
];

/** Control chars that are never legitimate CSV content (\n \r \t deliberately kept). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Pure neutralizer — exported for direct unit testing.
 *
 * @param {string} text raw external text
 * @param {number} [maxBytes]
 * @returns {{content: string, findings: Array<{severity: string, rule: string, offset: number, excerpt: string}>}}
 */
export function neutralizeText(text, maxBytes = DEFAULT_MAX_BYTES) {
  const findings = [];
  let content = typeof text === "string" ? text : "";

  if (content.length > maxBytes) {
    findings.push({
      severity: "major",
      rule: "oversize-truncated",
      offset: maxBytes,
      excerpt: `body truncated from ${content.length} to ${maxBytes} chars (max_bytes)`,
    });
    content = content.slice(0, maxBytes);
  }

  const controlHits = content.match(CONTROL_CHARS);
  if (controlHits) {
    findings.push({
      severity: "major",
      rule: "control-characters",
      offset: content.search(CONTROL_CHARS),
      excerpt: `${controlHits.length} control character(s) stripped`,
    });
    content = content.replace(CONTROL_CHARS, "");
  }

  for (const { id, re } of INJECTION_RULES) {
    // Fresh lastIndex per call — the module-level regexes are `g`/`gi`.
    re.lastIndex = 0;
    content = content.replace(re, (match, offset) => {
      findings.push({ severity: "major", rule: id, offset, excerpt: match.slice(0, 80) });
      return `[neutralized:${id}]`;
    });
  }

  return { content, findings };
}

export function sanitizeUntrusted(params) {
  return async (state) => {
    const raw = state[params.content_from];
    const field = params.field ?? "body";
    let text;
    if (typeof raw === "string") text = raw;
    else if (raw instanceof Uint8Array) text = Buffer.from(raw).toString("utf8");
    else if (raw && typeof raw === "object") text = raw[field];
    if (typeof text !== "string") {
      throw new Error(
        `commands.sanitizeUntrusted: channel '${params.content_from}' holds no string content (field='${field}', got ${typeof text})`,
      );
    }

    const { content, findings } = neutralizeText(text, params.max_bytes ?? DEFAULT_MAX_BYTES);
    const delta = { [params.into]: content };
    if (params.findings_into) delta[params.findings_into] = findings;
    return delta;
  };
}
