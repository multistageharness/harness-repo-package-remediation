/** views/patterns.js — the atomic pattern registry browser. */

import { el } from "../ui.js";

export async function patternsView(api) {
  const byCategory = await api.patterns();
  const order = ["prompt", "template", "skills", "commands", "knowledge", "nodes", "edges", "condition", "checkpoints"];
  const total = Object.values(byCategory).reduce((n, list) => n + list.length, 0);

  return el(
    "section",
    {},
    el("h1", { text: `Patterns (${total})` }),
    el(
      "div",
      { class: "stack" },
      order
        .filter((category) => byCategory[category])
        .map((category) =>
          el(
            "div",
            { class: "card" },
            el("h2", { text: `${category}.* — ${byCategory[category].length}` }),
            el(
              "table",
              { class: "list" },
              el("thead", {}, el("tr", {}, el("th", { text: "pattern" }), el("th", { text: "summary" }), el("th", { text: "module" }))),
              el(
                "tbody",
                {},
                byCategory[category].map((pattern) =>
                  el(
                    "tr",
                    {},
                    el("td", { class: "mono", text: pattern.name }),
                    el("td", { text: pattern.summary }),
                    el("td", { class: "mono", text: pattern.module }),
                  ),
                ),
              ),
            ),
          ),
        ),
    ),
  );
}
