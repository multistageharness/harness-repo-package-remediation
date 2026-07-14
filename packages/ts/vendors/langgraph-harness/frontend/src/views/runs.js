/** views/runs.js — recent run history from the backend run store. */

import { el } from "../ui.js";

const STATUS_CLASS = { completed: "ok", interrupted: "warn", failed: "err", running: "accent" };

export async function runsView(api) {
  const runs = await api.runs();
  if (runs.length === 0) {
    return el("section", {}, el("h1", { text: "Runs" }), el("div", { class: "empty", text: "No runs yet — open a flow and run it." }));
  }
  return el(
    "section",
    {},
    el("h1", { text: "Runs" }),
    el(
      "div",
      { class: "card" },
      el(
        "table",
        { class: "list" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", { text: "run" }),
            el("th", { text: "flow" }),
            el("th", { text: "status" }),
            el("th", { text: "thread" }),
            el("th", { text: "events" }),
            el("th", { text: "started" }),
          ),
        ),
        el(
          "tbody",
          {},
          runs.map((run) =>
            el(
              "tr",
              {},
              el("td", { class: "mono", text: run.id }),
              el("td", {}, el("a", { href: `#/flows/${run.flow}`, text: run.flow })),
              el("td", {}, el("span", { class: `pill ${STATUS_CLASS[run.status] ?? ""}`, text: run.status })),
              el("td", { class: "mono", text: run.thread_id ?? "—" }),
              el("td", { class: "mono", text: String(run.event_count) }),
              el("td", { class: "mono", text: run.started_at }),
            ),
          ),
        ),
      ),
    ),
  );
}
