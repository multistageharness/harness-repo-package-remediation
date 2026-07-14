/**
 * src/ui/search-multiselect.mjs — a searchable multi-select prompt where
 * **Space AND Tab toggle the highlighted row** and **every other character
 * feeds a live search filter**. Built directly on `@clack/core`'s base `Prompt`
 * because neither stock clack widget does both at once:
 *   - `multiselect` toggles on Space but has no search box;
 *   - `autocompleteMultiselect` searches but reserves Space for the search
 *     input, so it only toggles on Tab (Space toggles only after ↑/↓).
 *
 * Here Space is *reserved* for toggling (never typed into the query), so header
 * names — which never contain spaces — stay fully searchable while Space works
 * from the first keystroke. ↑/↓ navigate (wrapping), Enter confirms.
 *
 * Rendered in clack's own idiom (its bar/checkbox glyphs + `symbol()`), accented
 * with `chalk`, so it sits seamlessly inside a `@clack/prompts` session. This is
 * used only by the clack (interactive) binding; the scripted test binding is a
 * plain array replay and never touches this file.
 */
import { Prompt } from "@clack/core";
import { S_BAR, S_BAR_END, S_CHECKBOX_ACTIVE, S_CHECKBOX_INACTIVE, S_CHECKBOX_SELECTED, symbol } from "@clack/prompts";
import chalk from "chalk";

/** Rows visible in the viewport, centered on the cursor for long lists. */
function windowed(list, cursor, maxItems) {
  const n = list.length;
  const max = Math.min(maxItems, n);
  let start = 0;
  if (n > max) start = Math.max(0, Math.min(cursor - Math.floor(max / 2), n - max));
  const out = [];
  for (let i = start; i < start + max; i++) out.push({ opt: list[i], index: i });
  return { rows: out, more: n - (start + max), before: start };
}

class SearchMultiselectPrompt extends Prompt {
  constructor(opts) {
    super({ input: opts.input, output: opts.output, signal: opts.signal, render: renderFrame }, false);
    this.message = opts.message ?? "";
    this.list = (opts.options ?? []).map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) }));
    this.placeholder = opts.placeholder ?? "type to filter…";
    this.maxItems = opts.maxItems ?? 10;
    this.search = "";
    this.cursor = 0;
    this.selected = new Set((opts.initialValues ?? []).map(String));
    this.value = [...this.selected];

    this.on("key", (char, key) => this.onKeyPress(char, key));
    this.on("cursor", (action) => this.onCursorMove(action));
    this.on("finalize", () => {
      this.value = [...this.selected];
    });
  }

  /** Case-insensitive substring match on the label; empty query ⇒ all. */
  get filtered() {
    const q = this.search.trim().toLowerCase();
    return q ? this.list.filter((o) => o.label.toLowerCase().includes(q)) : this.list;
  }

  onCursorMove(action) {
    const len = this.filtered.length;
    if (len === 0) return;
    if (action === "up" || action === "left") this.cursor = (this.cursor - 1 + len) % len;
    else if (action === "down" || action === "right") this.cursor = (this.cursor + 1) % len;
  }

  onKeyPress(char, key) {
    const name = key?.name;
    // Space + Tab are RESERVED for toggling the highlighted row.
    if (name === "space" || name === "tab") {
      const opt = this.filtered[this.cursor];
      if (opt) {
        if (this.selected.has(opt.value)) this.selected.delete(opt.value);
        else this.selected.add(opt.value);
        this.value = [...this.selected];
      }
      return;
    }
    if (name === "return" || name === "escape" || name === "up" || name === "down") return;
    if (name === "backspace") {
      this.search = this.search.slice(0, -1);
      this.cursor = 0;
      return;
    }
    // Any other single printable character extends the search filter.
    if (char && char.length === 1 && !key?.ctrl && !key?.meta) {
      this.search += char;
      this.cursor = 0;
    }
  }
}

/** Render one frame. `this` is the prompt instance (bound by @clack/core). */
function renderFrame() {
  const barColor = this.state === "error" ? chalk.yellow : chalk.cyan;
  const grayBar = chalk.gray(S_BAR);
  const head = `${symbol(this.state)}  ${this.message}`;

  if (this.state === "submit") {
    const labels = this.list.filter((o) => this.selected.has(o.value)).map((o) => o.label);
    return `${grayBar}\n${head}\n${grayBar}  ${chalk.dim(labels.length ? labels.join(", ") : "none")}`;
  }
  if (this.state === "cancel") {
    return `${grayBar}\n${head}`;
  }

  const filtered = this.filtered;
  if (this.cursor >= filtered.length) this.cursor = Math.max(0, filtered.length - 1);

  const bar = barColor(S_BAR);
  const query = this.search.length ? this.search : chalk.dim(this.placeholder);
  const lines = [grayBar, head, `${bar}  ${chalk.dim("Search:")} ${query}`];

  if (filtered.length === 0) {
    lines.push(`${bar}  ${chalk.yellow("No matches")}`);
  } else {
    const { rows, more, before } = windowed(filtered, this.cursor, this.maxItems);
    if (before > 0) lines.push(`${bar}  ${chalk.dim(`↑ ${before} more`)}`);
    for (const { opt, index } of rows) {
      const active = index === this.cursor;
      const isSel = this.selected.has(opt.value);
      const box = isSel ? chalk.green(S_CHECKBOX_SELECTED) : active ? chalk.cyan(S_CHECKBOX_ACTIVE) : chalk.dim(S_CHECKBOX_INACTIVE);
      const label = active ? opt.label : isSel ? opt.label : chalk.dim(opt.label);
      lines.push(`${bar}  ${box} ${label}`);
    }
    if (more > 0) lines.push(`${bar}  ${chalk.dim(`↓ ${more} more`)}`);
  }

  const footer = [
    `${chalk.dim("↑/↓")} navigate`,
    `${chalk.dim("Space/Tab:")} select`,
    `${chalk.dim("Type:")} search`,
    `${chalk.dim("Enter:")} confirm`,
  ].join(chalk.dim(" • "));
  lines.push(`${bar}  ${chalk.dim(`${this.selected.size} selected`)}`);
  lines.push(`${bar}  ${footer}`);
  lines.push(barColor(S_BAR_END));
  return lines.join("\n");
}

/**
 * Prompt for a multi-selection with Space/Tab toggle + type-to-search.
 * @param {{message: string, options: Array<{value:string,label?:string}>,
 *   initialValues?: string[], placeholder?: string, maxItems?: number,
 *   input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream,
 *   signal?: AbortSignal}} opts
 * @returns {Promise<string[]|symbol>} selected values, or clack's cancel symbol
 */
export function searchMultiselect(opts) {
  return new SearchMultiselectPrompt(opts).prompt();
}
