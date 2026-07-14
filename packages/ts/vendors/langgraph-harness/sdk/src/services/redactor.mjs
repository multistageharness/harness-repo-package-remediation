/**
 * services/redactor.mjs — masks secret-shaped values before they reach logs,
 * events, or API responses (atomic service).
 *
 * Two layers:
 *  1. key-based — any object key matching KEY_PATTERN is fully masked;
 *  2. value-based — string values matching known token shapes are masked.
 */

const KEY_PATTERN = /(token|secret|password|passwd|api[_-]?key|authorization|bearer|credential)/i;

const VALUE_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI-style keys
  /(?:xox[baprs])-[A-Za-z0-9-]{10,}/g, // Slack
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT triplets
  /AKIA[0-9A-Z]{16}/g, // AWS access key ids
  /Bearer\s+[A-Za-z0-9._-]{16,}/gi,
];

export const MASK = "[REDACTED]";

/** Redact one string value. */
export function redactString(value) {
  let out = value;
  for (const re of VALUE_PATTERNS) out = out.replace(re, MASK);
  return out;
}

/** Deep-redact any JSON-ish value. Cycles are cut with "[Circular]". */
export function redactValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactString(value);
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = KEY_PATTERN.test(k) && typeof v === "string" && v.length > 0 ? MASK : redactValue(v, seen);
  }
  return out;
}
