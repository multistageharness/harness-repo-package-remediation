/**
 * src/ui/scripted-prompter.mjs — the offline, no-TTY binding of the `Prompter`
 * contract. It replays a queue of pre-scripted answers and accumulates every
 * rendered line into a transcript the tests assert against. This is the
 * testability linchpin: the whole wizard runs with no terminal, no network, no
 * key, no git — exactly what the pack's mock-first discipline requires.
 *
 * Answer forms per prompt:
 *   - text:        a string (blank/absent ⇒ `defaultValue`); a `validate`
 *                  function re-prompts by pulling the next answer, mirroring
 *                  clack's inline re-ask.
 *   - select:      an index ("2"), an exact value/label, or blank ⇒ initialValue.
 *   - multiselect: an array of values, OR a comma-separated index/value string,
 *                  OR blank ⇒ initialValues (⇒ [] by default).
 *   - confirm:     y/yes/true or n/no/false (case-insensitive), a boolean, or
 *                  blank ⇒ initialValue.
 *
 * `transcript()` returns everything written (prompts, notes, logs) joined by
 * newlines so tests can match on it the way they matched the old capturing
 * stream.
 */
import { normalizeChoices, resolveChoiceToken } from "./prompter.mjs";

/** Guard against a pathological validate loop when answers run out. */
const MAX_REASK = 100;

/**
 * @param {(string|string[]|boolean)[]} [answers] scripted answers, in prompt order
 * @returns {import("./prompter.mjs").Prompter & {transcript: () => string, lines: string[], remaining: () => number}}
 */
export function scriptedPrompter(answers = []) {
  const queue = answers.slice();
  const lines = [];
  const write = (s) => {
    for (const line of String(s).split("\n")) lines.push(line);
  };
  const shift = () => (queue.length ? queue.shift() : undefined);

  const listOptions = (options) => {
    normalizeChoices(options).forEach((c, i) => {
      write(`  ${i + 1}) ${c.label}`);
    });
  };

  return {
    lines,
    transcript: () => lines.join("\n"),
    remaining: () => queue.length,

    intro: (message) => write(message),
    outro: (message) => write(message),
    note: (message, title) => write(title ? `${title}\n${message}` : message),
    log: (message) => write(message),
    info: (message) => write(message),
    warn: (message) => write(message),
    error: (message) => write(message),
    success: (message) => write(message),

    async text({ message, defaultValue, validate } = {}) {
      write(message);
      for (let i = 0; i < MAX_REASK; i++) {
        const raw = shift();
        const value = raw === undefined || raw === "" ? (defaultValue ?? (raw ?? "")) : String(raw);
        if (validate) {
          const err = validate(value);
          if (err) {
            write(typeof err === "string" ? err : err.message);
            if (queue.length === 0) return value; // exhausted — best effort
            continue;
          }
        }
        return value;
      }
      return "";
    },

    async select({ message, options = [], initialValue } = {}) {
      write(message);
      listOptions(options);
      const raw = shift();
      if (raw === undefined || raw === "") return initialValue;
      return resolveChoiceToken(String(raw), options);
    },

    async multiselect({ message, options = [], initialValues = [] } = {}) {
      write(message);
      listOptions(options);
      const raw = shift();
      if (Array.isArray(raw)) return raw.map(String);
      if (raw === undefined || raw === "") return initialValues.slice();
      const seen = new Set();
      const picked = [];
      for (const token of String(raw).split(",")) {
        const t = token.trim();
        if (t === "") continue;
        const value = resolveChoiceToken(t, options);
        if (!seen.has(value)) {
          seen.add(value);
          picked.push(value);
        }
      }
      return picked;
    },

    async confirm({ message, initialValue = false } = {}) {
      write(message);
      const raw = shift();
      if (typeof raw === "boolean") return raw;
      if (raw === undefined || raw === "") return initialValue;
      const t = String(raw).trim().toLowerCase();
      if (/^(y|yes|true)$/.test(t)) return true;
      if (/^(n|no|false)$/.test(t)) return false;
      return initialValue;
    },

    /**
     * Stage-progress seam — a pure transcript no-op. No TTY, no ProgressBar
     * instantiation, so the wizard stays driveable with no terminal. Records a
     * deterministic `stage X of N` line per advance (mirroring how intro/note/log
     * already `write(...)`) so tests can assert the progress overlay fired.
     */
    progress({ total, label } = {}) {
      let current = 0;
      let finished = false;
      if (label) write(label);
      return {
        advance(step = 1, nextLabel) {
          if (finished) return;
          current = Math.min(current + step, total);
          write(`stage ${current} of ${total}${nextLabel ? ` — ${nextLabel}` : ""}`);
        },
        done() {
          if (finished) return;
          finished = true;
          write(`stage ${total} of ${total} — done`);
        },
      };
    },
  };
}
