/**
 * src/ui/clack-prompter.mjs — the real interactive prompter, built on
 * `@clack/prompts` (bombshell-dev/clack) with `chalk` for accenting.
 *
 * The wizard/steps never touch `@clack/prompts` directly — they talk to the
 * small `Prompter` contract (text / select / multiselect / confirm / note / log
 * + intro/outro framing). This file is the production binding of that contract;
 * `scripted-prompter.mjs` is the offline, no-TTY binding the tests drive. The
 * seam is what lets the whole wizard stay driveable without a terminal.
 *
 * A clack prompt returns a cancel *symbol* when the user hits Ctrl-C / Esc.
 * We centralize the `p.isCancel` guard here (the "guard after EVERY prompt"
 * rule) so a cancel anywhere renders a farewell and unwinds as `WizardDone(0)` —
 * individual steps never repeat the check.
 *
 * The header selector uses `searchMultiselect` — a custom clack-core prompt
 * where Space AND Tab toggle the highlighted row while any other character
 * filters the list (so a wide column list stays searchable and Space works from
 * the first keystroke, which stock `autocompleteMultiselect` does not allow).
 */
import * as p from "@clack/prompts";
import chalk from "chalk";

import { WizardDone } from "../step-control.mjs";
import { searchMultiselect } from "./search-multiselect.mjs";
import { ProgressBar } from "../progress-lib.mjs";

/** Throw `WizardDone(0)` on a clack cancel symbol; otherwise pass the value. */
function guard(value) {
  if (p.isCancel(value)) {
    p.cancel("Cancelled — no flow was executed.");
    throw new WizardDone(0);
  }
  return value;
}

/**
 * Build the interactive prompter. `io` optionally overrides the streams clack
 * reads/writes (defaults to the process streams).
 * @param {{input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream}} [io]
 * @returns {import("./prompter.mjs").Prompter}
 */
export function clackPrompter(io = {}) {
  const common = {};
  if (io.input) common.input = io.input;
  if (io.output) common.output = io.output;

  return {
    intro: (message) => p.intro(chalk.bgCyan.black(` ${message} `)),
    outro: (message) => p.outro(message),
    note: (message, title) => p.note(message, title),
    log: (message) => p.log.message(message),
    info: (message) => p.log.info(message),
    warn: (message) => p.log.warn(chalk.yellow(message)),
    error: (message) => p.log.error(chalk.red(message)),
    success: (message) => p.log.success(chalk.green(message)),

    async text(opts) {
      // Surface a `defaultValue` as a dim placeholder when the caller didn't set
      // one explicitly: a defaulted prompt then visibly shows what Enter accepts
      // (e.g. `.harness`), so an untouched input reads as "waiting on you", not a
      // hung/blank field. `defaultValue` alone is not rendered by clack.
      const merged = { ...common, ...opts };
      if (merged.placeholder == null && merged.defaultValue != null && merged.defaultValue !== "") {
        merged.placeholder = String(merged.defaultValue);
      }
      return guard(await p.text(merged));
    },
    async select(opts) {
      return guard(await p.select({ ...common, ...opts }));
    },
    /** Multi-pick — Space/Tab toggle, any other key filters (search-multiselect.mjs). */
    async multiselect(opts) {
      return guard(await searchMultiselect({ ...common, ...opts }));
    },
    async confirm(opts) {
      return guard(await p.confirm({ ...common, ...opts }));
    },

    /**
     * Stage-progress over a known total. Two renderings, picked by `animated`:
     *
     *   - `animated: false` (DEFAULT) — a **discrete** reporter for human-paced
     *     stages (the wizard's interactive steps). Each `advance` prints one
     *     quiet clack step line (`stage X of N — label`); no animated bar, no
     *     ETA/throughput (meaningless when we're blocked on user input), and no
     *     cursor hiding (which fights clack's own text prompts).
     *   - `animated: true` — the real animated `ProgressBar` from the vendored
     *     `@internal/tools-cli-progress-bar` (via the progress-lib bridge), for
     *     machine-paced batch work that owns the terminal (the per-repo clone
     *     fan-out during the run). Off a TTY the vendored lib auto-selects its
     *     silent renderer, so it stays inert without a terminal.
     */
    progress({ total, label = "Progress", animated = false } = {}) {
      let finished = false;
      if (animated) {
        const bar = new ProgressBar(total, label).start();
        return {
          advance(step = 1) {
            if (finished) return;
            bar.update(step);
          },
          done() {
            if (finished) return;
            finished = true;
            if (!bar.isCompleted()) bar.complete();
          },
        };
      }
      let current = 0;
      return {
        advance(step = 1, nextLabel) {
          if (finished) return;
          current = Math.min(current + step, total);
          p.log.step(`stage ${current} of ${total}${nextLabel ? ` — ${nextLabel}` : ""}`);
        },
        done() {
          finished = true;
        },
      };
    },
  };
}
