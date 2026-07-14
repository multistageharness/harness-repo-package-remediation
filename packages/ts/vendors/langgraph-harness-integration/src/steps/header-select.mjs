/**
 * steps/header-select.mjs — pick the working remediation subset of headers
 * (langgraph-flow.md step 3). Ingests the chosen file with a small limit to list
 * the parsed columns (like preview.mjs → `Object.keys(rows[0] ?? {})`), then
 * asks how to narrow them.
 *
 * TWO PROMPTS, NOT ONE. A `select` gate ("all headers" vs "pick specific
 * headers…") leads, and only the `pick` branch opens the multi-select. Keeping
 * every column used to be reachable only by confirming an EMPTY multi-select —
 * a discoverable-by-accident default that read as "you must choose something"
 * on a wide column list. The gate makes the common answer a first-class,
 * one-keystroke choice and leaves the searchable toggle list for the case that
 * actually needs it. Blank still answers the gate with `all`, so a scripted
 * queue that predates the gate replays unchanged.
 *
 * Picking nothing inside the `pick` branch is not a dead end: it warns and
 * falls back to all. The originals are never discarded either way — this only
 * records the subset on `ctx.plan.selectedHeaders`; the flow's
 * `dataset.original_headers` still carries every column for later reference.
 *
 * `parseHeaderSelection` remains a pure, tested resolver (1-based indices or
 * exact names → header list); the scripted prompter reuses the same index/value
 * semantics to replay a selection offline.
 *
 * Local reads are deterministic, so this runs for real even under mock.
 */

/**
 * Pure parse: map a comma-separated selection to header names. Blank ⇒ all.
 * Accepts 1-based indices and exact names; unknown/out-of-range ⇒ rejected.
 * @param {string} input
 * @param {string[]} columns
 * @returns {{ok: boolean, selected?: string[], reason?: string}}
 */
export function parseHeaderSelection(input, columns) {
  const raw = (input ?? "").trim();
  if (raw === "") return { ok: true, selected: columns.slice() };

  const selected = [];
  const seen = new Set();
  for (const tokenRaw of raw.split(",")) {
    const token = tokenRaw.trim();
    if (token === "") continue;
    let name;
    if (/^\d+$/.test(token)) {
      const idx = Number(token) - 1;
      if (idx < 0 || idx >= columns.length) {
        return { ok: false, reason: `index out of range: ${token} (1..${columns.length})` };
      }
      name = columns[idx];
    } else if (columns.includes(token)) {
      name = token;
    } else {
      return { ok: false, reason: `unknown header: ${token}` };
    }
    if (!seen.has(name)) {
      seen.add(name);
      selected.push(name);
    }
  }
  if (selected.length === 0) return { ok: false, reason: "no headers selected" };
  return { ok: true, selected };
}

/** The gate's answer set. `all` is the initial value, so blank ⇒ every column. */
export const HEADER_MODE_ALL = "all";
export const HEADER_MODE_PICK = "pick";

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 * @param {{limit?: number}} [opts]
 */
export async function headerSelectStep(ctx, { limit = 5 } = {}) {
  const { ingest } = await import("@harness/sdk");
  const { rows } = await ingest(ctx.plan.inputPath, { limit });
  const columns = Object.keys(rows[0] ?? {});

  const mode = await ctx.prompt.select({
    message: "Headers to keep for remediation (originals kept for reference)",
    options: [
      { value: HEADER_MODE_ALL, label: `All headers (${columns.length})`, hint: "keep every parsed column" },
      { value: HEADER_MODE_PICK, label: "Pick specific headers…", hint: "search, Space/Tab to toggle" },
    ],
    initialValue: HEADER_MODE_ALL,
  });

  let selected = columns.slice();
  if (mode === HEADER_MODE_PICK) {
    const picked = await ctx.prompt.multiselect({
      message: "Headers to keep for remediation (search/space to toggle; none = all)",
      options: columns.map((c) => ({ value: c, label: c })),
      required: false,
      placeholder: "type to filter columns…",
    });
    // Confirming an empty pick list is not a dead end — it means "all" (the
    // pre-gate behavior), but say so rather than silently widening the subset.
    if (picked.length > 0) selected = picked;
    else ctx.prompt.warn("No headers picked — keeping all of them.");
  }

  ctx.plan.selectedHeaders = selected;
  ctx.prompt.success(`Selected headers: ${selected.join(", ")}`);
}
