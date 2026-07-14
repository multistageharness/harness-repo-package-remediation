/**
 * src/ui/prompter.mjs — the prompter contract the wizard and its steps program
 * against, plus small shared helpers for the two bindings.
 *
 * A `Prompter` is the single seam between the wizard's guided steps and the
 * outside world. The clack binding (`clack-prompter.mjs`) renders real
 * interactive prompts; the scripted binding (`scripted-prompter.mjs`) replays a
 * queue of answers with zero TTY so the whole wizard is driveable in tests.
 * Both accept the same clack-shaped option objects so a step reads identically
 * under either.
 *
 * @typedef {Object} Choice
 * @property {string} value  the value returned when picked
 * @property {string} [label] user-facing text (defaults to `value`)
 * @property {string} [hint]  optional trailing hint
 *
 * @typedef {Object} Prompter
 * @property {(message: string) => void} intro   session banner
 * @property {(message: string) => void} outro   session farewell
 * @property {(message: string, title?: string) => void} note  framed block
 * @property {(message: string) => void} log     plain line
 * @property {(message: string) => void} info    informational line
 * @property {(message: string) => void} warn    warning line
 * @property {(message: string) => void} error   error line
 * @property {(message: string) => void} success success line
 * @property {(opts: {message: string, placeholder?: string, defaultValue?: string, initialValue?: string, validate?: (v: string) => string|Error|undefined}) => Promise<string>} text
 * @property {(opts: {message: string, options: Choice[], initialValue?: string}) => Promise<string>} select
 * @property {(opts: {message: string, options: Choice[], initialValues?: string[], required?: boolean, placeholder?: string}) => Promise<string[]>} multiselect
 * @property {(opts: {message: string, initialValue?: boolean}) => Promise<boolean>} confirm
 * @property {(opts: {total: number, label?: string, animated?: boolean}) => ProgressReporter} [progress]
 *   OPTIONAL progress seam. Opens a reporter over a known total. With
 *   `animated: false` (default) the clack binding renders DISCRETE `stage X of N`
 *   step lines — for human-paced wizard stages (no bar, no ETA, no cursor hide).
 *   With `animated: true` it renders the real animated terminal bar (via the
 *   vendored `@internal/tools-cli-progress-bar`) — for machine-paced batch work
 *   that owns the terminal (the per-repo clone fan-out). The scripted binding
 *   no-ops both to the transcript. Callers must tolerate its absence (older
 *   bindings) and a plain no-op reporter (scripted).
 *
 * @typedef {Object} ProgressReporter
 * @property {(step?: number, label?: string) => void} advance  mark N stages done (default 1), optionally relabel
 * @property {(label?: string) => void} done  finish the bar (idempotent)
 */

/**
 * Normalize a choice list — a bare string or a `{value,label,hint}` object —
 * into `{value, label}` records. Shared by the scripted binding's resolvers.
 * @param {(string|Choice)[]} options
 * @returns {{value: string, label: string}[]}
 */
export function normalizeChoices(options = []) {
  return options.map((o) =>
    typeof o === "object" && o !== null
      ? { value: String(o.value), label: String(o.label ?? o.value) }
      : { value: String(o), label: String(o) },
  );
}

/**
 * Resolve one raw token (a 1-based index or an exact value/label) to a choice
 * value. Unknown tokens pass through unchanged so a step's own validation can
 * reject them.
 * @param {string} token
 * @param {(string|Choice)[]} options
 * @returns {string}
 */
export function resolveChoiceToken(token, options) {
  const choices = normalizeChoices(options);
  const t = String(token ?? "").trim();
  if (/^\d+$/.test(t)) {
    const idx = Number(t) - 1;
    if (idx >= 0 && idx < choices.length) return choices[idx].value;
  }
  const hit = choices.find((c) => c.value === t || c.label === t);
  return hit ? hit.value : t;
}
