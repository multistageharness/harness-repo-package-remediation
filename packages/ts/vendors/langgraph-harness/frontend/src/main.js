/**
 * main.js — hash router + app shell for the langgraph-langchain-harness console.
 *   #/flows           flow catalog (default)
 *   #/flows/:name     flow detail: graph, yaml, live run panel
 *   #/patterns        pattern registry
 *   #/runs            run history
 */

import "./styles.css";
import { el, clear } from "./ui.js";
import { createApi } from "./api.js";
import { flowsView } from "./views/flows.js";
import { flowDetailView } from "./views/flow-detail.js";
import { patternsView } from "./views/patterns.js";
import { runsView } from "./views/runs.js";

const api = createApi("");
const app = document.getElementById("app");

const navLinks = [
  { hash: "#/flows", label: "Flows" },
  { hash: "#/patterns", label: "Patterns" },
  { hash: "#/runs", label: "Runs" },
];

const metaSlot = el("span", { class: "meta", text: "…" });
const nav = el(
  "nav",
  {},
  navLinks.map((link) => el("a", { href: link.hash, text: link.label, "data-hash": link.hash })),
);
const header = el(
  "header",
  { class: "top" },
  el("div", { class: "brand" }, "langgraph-langchain-harness ", el("span", { text: "console" })),
  nav,
  metaSlot,
);
const main = el("main", {});
app.append(header, main);

api
  .meta()
  .then((meta) => {
    metaSlot.textContent = `v${meta.version} · ${meta.flow_count} flows · ${meta.pattern_count} patterns · yaml→mapping→registry→execute`;
  })
  .catch(() => {
    metaSlot.textContent = "backend unreachable";
  });

async function route() {
  const hash = location.hash || "#/flows";
  for (const link of nav.querySelectorAll("a")) {
    link.classList.toggle("active", hash === link.dataset.hash || (link.dataset.hash === "#/flows" && hash.startsWith("#/flows")));
  }
  clear(main);
  const spinner = el("div", { class: "empty", text: "loading…" });
  main.append(spinner);
  try {
    let view;
    const flowMatch = /^#\/flows\/([^/]+)$/.exec(hash);
    if (flowMatch) view = await flowDetailView(api, decodeURIComponent(flowMatch[1]));
    else if (hash === "#/patterns") view = await patternsView(api);
    else if (hash === "#/runs") view = await runsView(api);
    else view = await flowsView(api);
    clear(main).append(view);
  } catch (err) {
    clear(main).append(
      el("div", { class: "banner err", text: `failed to load: ${err.message}` }),
      el("div", { class: "empty", text: "is the backend running? npm run serve" }),
    );
  }
}

window.addEventListener("hashchange", route);
route();
