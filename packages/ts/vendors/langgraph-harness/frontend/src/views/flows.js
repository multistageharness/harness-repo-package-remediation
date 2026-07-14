/** views/flows.js — the flow catalog. */

import { el } from "../ui.js";

export async function flowsView(api) {
  const flows = await api.flows();
  return el(
    "section",
    {},
    el("h1", { text: "Flows" }),
    el(
      "div",
      { class: "grid" },
      flows.map((flow) =>
        el(
          "div",
          { class: "card clickable", onclick: () => (location.hash = `#/flows/${flow.name}`) },
          el("h3", { text: flow.name }),
          el("p", { text: flow.description || "(no description)" }),
          el("span", { class: "pill", text: `${flow.nodes} nodes` }),
          el("span", { class: "pill", text: `${flow.edges} edges` }),
          el("span", { class: "pill mono", text: flow.file }),
        ),
      ),
    ),
  );
}
